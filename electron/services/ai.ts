// Ollama AI Service for keyword extraction

const OLLAMA_BASE_URL = 'http://localhost:11434';
let modelName = 'nemotron-3-nano:30b-cloud'; // Default model

export function setModel(name: string) {
    modelName = name;
    console.log(`AI model set to: ${modelName}`);
}

export async function extractKeywords(text: string, existingKeywords: string[], retryCount: number = 0): Promise<{ existing: string[], new: string[] }> {
    const keywordList = existingKeywords.length > 0 ? existingKeywords.join(', ') : "None";
    
    // Truncate text to avoid token limits
    const truncatedText = text.substring(0, 15000);

    const prompt = `You are an expert academic librarian. Extract keywords for this academic paper.

Keywords already in our database (available for reuse):
${keywordList}

Your task:
1. Read the paper and identify its MAIN TOPICS
2. From the keywords above, select UP TO 5 that are TRULY RELEVANT to this paper
   - Only select if the keyword directly relates to the paper content
   - It's OK to select 0 if none are relevant
3. Create EXACTLY 5 NEW keywords specific to THIS paper
   - These should capture the unique topics NOT covered by existing keywords
   - Use specific academic terms

RESPOND WITH ONLY THIS JSON (no markdown, no explanation):
{"existing": ["max 5 relevant keywords"], "new": ["exactly 5 new keywords"]}

Paper text:
${truncatedText}`;

    try {
        console.log(`Calling Ollama (${modelName}) for keyword extraction...`);
        
        const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.1,
                    num_predict: 1000
                }
            })
        });

        // Handle rate limiting with retry
        if (response.status === 429) {
            if (retryCount < 3) {
                const waitTime = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s
                console.log(`Rate limited, waiting ${waitTime/1000}s before retry ${retryCount + 1}/3...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return extractKeywords(text, existingKeywords, retryCount + 1);
            }
            throw new Error(`Ollama request failed after 3 retries: 429 Too Many Requests`);
        }

        if (!response.ok) {
            throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.response || '';
        
        console.log('Ollama response:', content);

        // Parse JSON from response - handle markdown code blocks
        let cleanContent = content;
        
        // Remove markdown code block wrappers
        if (cleanContent.includes('```json')) {
            cleanContent = cleanContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        } else if (cleanContent.includes('```')) {
            cleanContent = cleanContent.replace(/```\s*/g, '');
        }
        
        const jsonStart = cleanContent.indexOf('{');
        const jsonEnd = cleanContent.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            let jsonStr = cleanContent.substring(jsonStart, jsonEnd + 1);
            
            // Try to fix truncated JSON
            try {
                const result = JSON.parse(jsonStr);
                console.log('Parsed keywords:', result);
                
                // Limit existing to max 5, new to 5
                const existing = (result.existing || []).slice(0, 5);
                const newKws = (result.new || []).slice(0, 5);
                
                return { existing, new: newKws };
            } catch (parseError) {
                // Try to repair incomplete JSON
                console.log('Attempting to repair JSON...');
                
                // Check if arrays are incomplete
                if (!jsonStr.endsWith('}')) {
                    // Try to close incomplete arrays and object
                    const openBrackets = (jsonStr.match(/\[/g) || []).length;
                    const closeBrackets = (jsonStr.match(/\]/g) || []).length;
                    
                    for (let i = 0; i < openBrackets - closeBrackets; i++) {
                        jsonStr += ']';
                    }
                    jsonStr += '}';
                }
                
                try {
                    const result = JSON.parse(jsonStr);
                    console.log('Repaired and parsed keywords:', result);
                    const existing = (result.existing || []).slice(0, 5);
                    const newKws = (result.new || []).slice(0, 5);
                    return { existing, new: newKws };
                } catch (e) {
                    console.error('Failed to parse/repair JSON:', jsonStr.substring(0, 200));
                }
            }
        }
        
        console.warn('Could not parse keywords from Ollama response');
        return { existing: [], new: [] };
    } catch (error) {
        console.error("Error calling Ollama:", error);
        // Return empty rather than throwing to allow graceful degradation
        return { existing: [], new: [] };
    }
}

// Check if Ollama is running
export async function checkOllamaStatus(): Promise<boolean> {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        return response.ok;
    } catch {
        return false;
    }
}

// List available models
export async function listModels(): Promise<string[]> {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        if (response.ok) {
            const data = await response.json();
            return (data.models || []).map((m: { name: string }) => m.name);
        }
    } catch {
        // Ollama not running
    }
    return [];
}
