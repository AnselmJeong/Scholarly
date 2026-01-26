import ollama from 'ollama';

// Ollama AI Service for keyword extraction
const OLLAMA_BASE_URL = 'http://localhost:11434';
let keywordModel = 'nemotron-3-nano:30b-cloud'; // Default for keywords
let chatModel = 'mistral-large-3:675b-cloud';    // Default for chat

// Legacy support
export function setModel(name: string) {
    keywordModel = name;
    chatModel = name;
    console.log(`AI models set to: ${name}`);
}

export function setKeywordModel(name: string) {
    keywordModel = name;
    console.log(`Keyword AI model set to: ${name}`);
}

export function setChatModel(name: string) {
    chatModel = name;
    console.log(`Chat AI model set to: ${name}`);
}

/**
 * NEW: Free keyword extraction without structured output
 * Phase 1 of the embedding-based pipeline
 * Extracts 15 keywords that LLM thinks are most relevant
 */
export async function extractKeywordsRaw(text: string, retryCount: number = 0): Promise<string[]> {
    // Truncate text to avoid token limits
    const truncatedText = text.substring(0, 15000);

    const prompt = `Extract exactly 15 keywords that represent this academic paper's content.

Guidelines:
- Keywords should be noun phrases (1-4 words typically)
- Avoid overly generic terms that apply to most papers in the field
- Provide keywords for established concepts, methods, or domains that situate this paper.

Output format:
Return ONLY the keywords as a comma-separated list. Do not use numbering, bullets, or JSON.

Example output:
Keyword One, Keyword Two, Keyword Three, ...

Paper text:
${truncatedText}`;

    try {
        console.log(`Calling Ollama (${keywordModel}) for free keyword extraction...`);
        
        const response = await ollama.chat({
            model: keywordModel,
            messages: [{ role: 'user', content: prompt }],
            options: {
                temperature: 0.8,
                num_predict: 500
            }
        });

        const content = (response.message.content || '').trim();
        console.log('Ollama raw keywords response:', content);

        // Clean up response if it contains "Keywords:" prefix or similar
        let cleanContent = content.replace(/^Keywords:?/i, '').replace(/Here are.*?:\s*/i, '').trim();
        
        // Remove markdown formatting if present (bold, etc)
        cleanContent = cleanContent.replace(/\*\*/g, '').replace(/\*/g, '');

        // Parse comma-separated list
        const keywords = cleanContent
            .split(/,|\n/)  // Split by comma or newline (in case model ignores instruction)
            .map((kw: string) => kw.trim().toLowerCase())
            .filter((kw: string) => kw.length > 0 && kw.length < 100)
            .map((kw: string) => {
                // Title case normalization
                return kw.split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            });

        // Remove duplicates and non-keywords (e.g. "1.", "-", etc if splitting failed)
        const unique = [...new Set(keywords)]
            .filter(kw => !/^\d+\.?$/.test(kw)) // Remove disconnected numbers
            .filter(kw => kw.length > 2); // Remove too short junk
        
        console.log(`Extracted ${unique.length} unique keywords`);
        return unique.slice(0, 15);  // Cap at 15
        
    } catch (error) {
        console.error("Error calling Ollama for keyword extraction:", error);
        
        // Retry on failure
        if (retryCount < 3) {
            const waitTime = Math.pow(2, retryCount) * 2000;
            console.log(`Retrying in ${waitTime/1000}s... (attempt ${retryCount + 1}/3)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return extractKeywordsRaw(text, retryCount + 1);
        }
        
        return [];
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

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export async function chatWithPaper(
    contextText: string, 
    messages: ChatMessage[]
): Promise<string> {
    
    // Truncate context if it's too large (conservative limit for 32k/8k models)
    // Increased to 120,000 chars (~30k tokens) to capture full papers
    const truncatedContext = contextText.substring(0, 120000);

    const systemPrompt = truncatedContext.trim().length > 0 
    ? `You are an helpful academic research assistant. 
    You have read the following academic paper. 
    Answer the user's questions based ONLY on the content provided below.
    If the answer is not in the text, say you don't know.
    
    IMPORTANT: You must answer in KOREAN (한국어) unless the user specifically asks for another language.
    
    --- PAPER CONTENT BEGINS ---
    ${truncatedContext}
    --- PAPER CONTENT ENDS ---
    `
    : `You are an helpful academic research assistant.
    However, the content of the academic paper could not be extracted (it might be a scanned image or corrupted).
    
    IMPORTANT: You must inform the user in KOREAN (한국어) that you cannot answer questions about the paper because the text content is missing or unreadable. 
    Do not make up facts about the paper.`;

    // Construct full message history starting with system prompt
    const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
    ];

    try {
        console.log(`Sending chat request to Ollama (${chatModel})...`);
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: chatModel,
                messages: fullMessages,
                stream: false, // For now, we'll do non-streaming for simplicity
                options: {
                    temperature: 0.3, // Slightly higher for more natural chat
                    num_ctx: 32768    // Request larger context window if supported
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama chat failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.message?.content || "No response received.";

    } catch (error) {
        console.error("Error in chatWithPaper:", error);
        throw error;
    }
}
