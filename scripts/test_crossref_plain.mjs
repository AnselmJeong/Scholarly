
// Standalone test for CrossRef API
// Emulates the logic in electron/services/crossref.ts

async function searchCrossref(title, author) {
  try {
    const encodedTitle = encodeURIComponent(title);
    let url = `https://api.crossref.org/works?query.title=${encodedTitle}`;
    if (author) {
        url += `&query.author=${encodeURIComponent(author)}`;
    }
    url += `&rows=5`;
    
    console.log(`Fetching: ${url}`);
    
    const response = await fetch(
      url,
      {
        headers: {
          'User-Agent': 'AcademicKeywordManager/1.0 (mailto:anselmjeong@gmail.com)'
        }
      }
    );

    if (!response.ok) {
      console.error('Crossref API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.message.items;
  } catch (error) {
    console.error('Error searching Crossref:', error);
    return null;
  }
}

async function test() {
    const testTitle = "Attention Is All You Need";
    const testAuthor = "Vaswani";
    console.log(`Searching for: ${testTitle} by ${testAuthor}`);
    
    const results = await searchCrossref(testTitle, testAuthor);
    
    if (results && results.length > 0) {
        console.log(`Found ${results.length} results:`);
        results.forEach((r, i) => {
            console.log(`\n[${i+1}] ${r.title ? r.title[0] : 'No Title'}`);
            console.log(`    DOI: ${r.DOI}`);
            console.log(`    Type: ${r.type}`);
            console.log(`    Publisher: ${r.publisher}`);
            console.log(`    Year: ${r.issued?.['date-parts']?.[0]?.[0]}`);
            console.log(`    Container: ${r['container-title']?.[0]}`);
             console.log(`    Score: ${r.score}`);
        });
    } else {
        console.log("No metadata found.");
    }
}

test();
