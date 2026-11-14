use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use walkdir::WalkDir;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Settings {
    pub(crate) root: String,
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) models_by_provider: std::collections::BTreeMap<String, String>,
    pub(crate) effort: String,
    pub(crate) language: String,
    pub(crate) reader_appearance: String,
    pub(crate) guidance: String,
    pub(crate) codex_path: String,
    pub(crate) claude_path: String,
    pub(crate) ollama_url: String,
}
impl Settings {
    pub(crate) fn provider_label(&self) -> &str {
        match self.provider.as_str() {
            "codex" => "Codex",
            "claude" => "Claude",
            "ollama" => "Ollama",
            _ => "AI 미설정",
        }
    }
    pub(crate) fn language_label(&self) -> &str {
        if self.language == "en" {
            "영어"
        } else {
            "한국어"
        }
    }
    pub(crate) fn generation_label(&self) -> String {
        format!(
            "{} · {} · {}",
            self.provider_label(),
            if self.model.is_empty() {
                "계정 기본 모델"
            } else {
                &self.model
            },
            self.language_label()
        )
    }
    pub(crate) fn load(home: &Path) -> Result<Self> {
        fs::create_dir_all(home)?;
        let current = home.join("settings.json");
        if current.exists() {
            return Ok(serde_json::from_slice(&fs::read(current)?)?);
        }
        let mut result = Self {
            provider: "codex".into(),
            effort: "low".into(),
            language: "ko".into(),
            ollama_url: "https://ollama.com/v1".into(),
            ..Default::default()
        };
        let old = legacy_home().join("settings.json");
        if old.exists() {
            let v: serde_json::Value = serde_json::from_slice(&fs::read(old)?)?;
            result.root = v
                .pointer("/library/lastRootPath")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into();
            let ai = v.get("ai").unwrap_or(&v);
            if let Some(models) = ai["modelsByProvider"].as_object() {
                for (name, value) in models {
                    if let Some(model) = value["guideModel"].as_str() {
                        result.models_by_provider.insert(name.clone(), model.into());
                    }
                }
            }
            for (field, key) in [
                (&mut result.provider, "provider"),
                (&mut result.model, "guideModel"),
                (&mut result.codex_path, "codexPath"),
                (&mut result.claude_path, "claudePath"),
                (&mut result.guidance, "guidePrompt"),
                (&mut result.language, "outputLanguage"),
            ] {
                if let Some(s) = ai.get(key).and_then(|v| v.as_str()) {
                    *field = s.into();
                }
            }
        }
        result.save(home)?;
        Ok(result)
    }
    pub(crate) fn save(&self, home: &Path) -> Result<()> {
        super::reading::atomic_write(
            &home.join("settings.json"),
            &serde_json::to_vec_pretty(self)?,
            false,
        )
    }
}
pub(crate) fn legacy_home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
        .join("Library/Application Support/Scholarly")
}
pub(crate) fn app_home() -> PathBuf {
    std::env::var_os("SCHOLARLY_NATIVE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| legacy_home().with_file_name("Scholarly Native"))
}
#[derive(Clone, Debug)]
pub(crate) struct Article {
    pub(crate) id: i64,
    pub(crate) path: PathBuf,
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) year: Option<i64>,
    pub(crate) doi: String,
    pub(crate) is_key: bool,
    pub(crate) is_read: bool,
    pub(crate) keywords: String,
    pub(crate) keyword_list: Vec<String>,
    pub(crate) journal: String,
    pub(crate) abstract_text: String,
}
pub(crate) struct Library {
    connection: Connection,
}
impl Library {
    pub(crate) fn open(home: &Path) -> Result<Self> {
        static INITIALIZE: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _initializing = INITIALIZE
            .lock()
            .map_err(|_| anyhow::anyhow!("Database initialization interrupted"))?;
        fs::create_dir_all(home)?;
        let target = home.join("database.sqlite");
        let original = legacy_home().join("database.sqlite");
        if !target.exists() && original.exists() {
            let source = Connection::open_with_flags(&original, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let temp = home.join("migration.sqlite.tmp");
            let mut destination = Connection::open(&temp)?;
            {
                let backup = rusqlite::backup::Backup::new(&source, &mut destination)?;
                backup.run_to_completion(256, Duration::from_millis(10), None)?;
            }
            let check: String =
                destination.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if check != "ok" {
                bail!("Database backup integrity check failed");
            }
            drop(destination);
            fs::rename(temp, &target)?;
            fs::write(
                home.join("migration.json"),
                serde_json::to_vec_pretty(
                    &serde_json::json!({"source":original,"method":"SQLite online backup","integrity":"ok","original_unchanged":true}),
                )?,
            )?;
        }
        let connection = Connection::open(target)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY,filename TEXT NOT NULL,file_path TEXT NOT NULL UNIQUE,title TEXT,authors TEXT,year INTEGER,journal TEXT,doi TEXT,metadata_source TEXT,abstract TEXT,added_date INTEGER,last_modified INTEGER,file_hash TEXT,file_size INTEGER,is_key INTEGER DEFAULT 0,is_read INTEGER DEFAULT 0,pdf_context TEXT);
          CREATE TABLE IF NOT EXISTS keywords(id INTEGER PRIMARY KEY,keyword TEXT UNIQUE NOT NULL,usage_count INTEGER DEFAULT 0,created_date INTEGER);
          CREATE TABLE IF NOT EXISTS article_keywords(article_id INTEGER REFERENCES articles(id),keyword_id INTEGER REFERENCES keywords(id),confidence REAL DEFAULT 1,added_date INTEGER,PRIMARY KEY(article_id,keyword_id));
          CREATE TABLE IF NOT EXISTS chat_sessions(id INTEGER PRIMARY KEY,article_id INTEGER REFERENCES articles(id),title TEXT,created_date INTEGER,updated_date INTEGER);
          CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY,session_id INTEGER REFERENCES chat_sessions(id),role TEXT NOT NULL,content TEXT NOT NULL,label TEXT,created_date INTEGER);
          CREATE TABLE IF NOT EXISTS personal_notes(article_id INTEGER PRIMARY KEY REFERENCES articles(id),content TEXT NOT NULL);")?;
        Ok(Self { connection })
    }
    pub(crate) fn scan(&mut self, root: &Path) -> Result<usize> {
        if !root.is_dir() {
            bail!("논문 폴더에 접근할 수 없습니다.");
        }
        let known = self
            .articles(root)?
            .into_iter()
            .map(|a| a.path)
            .collect::<std::collections::HashSet<_>>();
        let root = root.canonicalize()?;
        let mut found = Vec::new();
        let mut count = 0;
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                e.depth() == 0
                    || (!e.file_name().to_string_lossy().starts_with('.')
                        && e.file_name() != "summary"
                        && e.file_name() != "exports")
            })
        {
            let entry = entry?;
            if !entry.file_type().is_file()
                || entry
                    .path()
                    .extension()
                    .is_none_or(|x| !x.eq_ignore_ascii_case("pdf"))
            {
                continue;
            }
            let path = entry.path().to_path_buf();
            count += 1;
            if known.contains(&path) {
                continue;
            }
            found.push((
                entry.file_name().to_string_lossy().into_owned(),
                path.to_string_lossy().into_owned(),
                entry
                    .path()
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                entry.metadata()?.len() as i64,
            ));
        }
        let transaction = self.connection.transaction()?;
        for (filename, path, title, size) in found {
            transaction.execute("INSERT OR IGNORE INTO articles(filename,file_path,title,file_size) VALUES (?1,?2,?3,?4)",params![filename,path,title,size])?;
        }
        transaction.commit()?;
        Ok(count)
    }
    pub(crate) fn articles(&self, root: &Path) -> Result<Vec<Article>> {
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let mut statement=self.connection.prepare("SELECT a.id,a.file_path,COALESCE(a.title,a.filename),COALESCE(a.authors,''),a.year,COALESCE(a.doi,''),COALESCE(a.is_key,0),COALESCE(a.is_read,0),COALESCE((SELECT group_concat(k.keyword, ', ') FROM keywords k JOIN article_keywords ak ON k.id=ak.keyword_id WHERE ak.article_id=a.id),''),COALESCE(a.journal,''),COALESCE(a.abstract,''),(SELECT json_group_array(k.keyword) FROM keywords k JOIN article_keywords ak ON k.id=ak.keyword_id WHERE ak.article_id=a.id) FROM articles a ORDER BY a.year DESC,a.title")?;
        let rows = statement.query_map([], |r| {
            Ok(Article {
                id: r.get(0)?,
                path: PathBuf::from(r.get::<_, String>(1)?),
                title: r.get(2)?,
                authors: r.get(3)?,
                year: r.get(4)?,
                doi: r.get(5)?,
                is_key: r.get::<_, i64>(6)? != 0,
                is_read: r.get::<_, i64>(7)? != 0,
                keywords: r.get(8)?,
                keyword_list: serde_json::from_str(&r.get::<_, String>(11)?).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        11,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?,
                journal: r.get(9)?,
                abstract_text: r.get(10)?,
            })
        })?;
        let mut articles = Vec::new();
        for a in rows {
            let a = a?;
            if a.path.starts_with(&root) {
                articles.push(a);
            }
        }
        Ok(articles)
    }
    pub(crate) fn flag(&self, id: i64, key: bool, value: bool) -> Result<()> {
        self.connection.execute(
            if key {
                "UPDATE articles SET is_key=?1 WHERE id=?2"
            } else {
                "UPDATE articles SET is_read=?1 WHERE id=?2"
            },
            params![value, id],
        )?;
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn set_keywords(&mut self, id: i64, words: &str) -> Result<()> {
        self.set_keyword_list(id, &words.split(',').map(str::to_owned).collect::<Vec<_>>())
    }
    pub(crate) fn set_keyword_list(&mut self, id: i64, words: &[String]) -> Result<()> {
        let t = self.connection.transaction()?;
        t.execute("DELETE FROM article_keywords WHERE article_id=?1", [id])?;
        for word in words.iter().map(|s| s.trim()).filter(|w| !w.is_empty()) {
            t.execute("INSERT OR IGNORE INTO keywords(keyword) VALUES(?1)", [word])?;
            t.execute("INSERT OR IGNORE INTO article_keywords(article_id,keyword_id) SELECT ?1,id FROM keywords WHERE keyword=?2",params![id,word])?;
        }
        t.commit()?;
        Ok(())
    }
    pub(crate) fn notes(&self, id: i64) -> Result<String> {
        use rusqlite::OptionalExtension;
        Ok(self
            .connection
            .query_row(
                "SELECT content FROM personal_notes WHERE article_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or_default())
    }
    pub(crate) fn save_notes(&self, id: i64, text: &str) -> Result<()> {
        self.connection.execute("INSERT INTO personal_notes VALUES(?1,?2) ON CONFLICT(article_id) DO UPDATE SET content=excluded.content",params![id,text])?;
        Ok(())
    }
    pub(crate) fn messages(&self, id: i64) -> Result<Vec<(String, String)>> {
        let mut s=self.connection.prepare("SELECT m.role,m.content FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id WHERE s.article_id=?1 ORDER BY m.id")?;
        Ok(s.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }
    pub(crate) fn save_exchange(&mut self, id: i64, question: &str, answer: &str) -> Result<()> {
        let t = self.connection.transaction()?;
        t.execute(
            "INSERT INTO chat_sessions(article_id,title) VALUES(?1,?2)",
            params![id, question.chars().take(80).collect::<String>()],
        )?;
        let session = t.last_insert_rowid();
        for (role, text) in [("user", question), ("assistant", answer)] {
            t.execute(
                "INSERT INTO chat_messages(session_id,role,content) VALUES(?1,?2,?3)",
                params![session, role, text],
            )?;
        }
        t.commit()?;
        Ok(())
    }
    pub(crate) fn update_metadata(
        &self,
        id: i64,
        title: &str,
        authors: &str,
        year: Option<i64>,
        doi: &str,
    ) -> Result<()> {
        self.connection.execute("UPDATE articles SET title=?1,authors=?2,year=?3,doi=?4,metadata_source='manual' WHERE id=?5",params![title,authors,year,doi,id]).context("메타데이터 저장 실패")?;
        Ok(())
    }
}
