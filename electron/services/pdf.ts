import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function extractText(filePath: string): Promise<string> {
    try {
        // Use pdftotext if available (from poppler)
        try {
            const { stdout } = await execAsync(`pdftotext "${filePath}" -`);
            if (stdout && stdout.trim().length > 0) {
                console.log(`Extracted ${stdout.length} chars from ${path.basename(filePath)}`);
                return stdout;
            }
        } catch {
            console.log('pdftotext not available, using fallback');
        }

        // Fallback: Try dynamic import of pdf-parse
        try {
            const pdfParse = await import('pdf-parse');
            const dataBuffer = fs.readFileSync(filePath);
            // Handle both default export and named export
            const parser = (pdfParse as any).default || pdfParse;
            const data = await parser(dataBuffer);
            console.log(`Extracted ${data.text.length} chars from ${path.basename(filePath)}`);
            return data.text;
        } catch (e) {
            console.error('pdf-parse failed:', e);
        }

        // Last resort: just return filename as placeholder
        console.warn(`Could not extract text from ${filePath}, using filename`);
        return path.basename(filePath);
    } catch (error) {
        console.error(`Error extracting text from ${filePath}:`, error);
        throw error;
    }
}
