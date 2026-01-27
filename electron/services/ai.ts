// Ollama AI Service for chat functionality
const OLLAMA_BASE_URL = 'http://localhost:11434';
let chatModel = 'mistral-large-3:675b-cloud';    // Default for chat

// Legacy support - sets chat model only now
export function setModel(name: string) {
    chatModel = name;
    console.log(`AI model set to: ${name}`);
}



export function setChatModel(name: string) {
    chatModel = name;
    console.log(`Chat AI model set to: ${name}`);
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
