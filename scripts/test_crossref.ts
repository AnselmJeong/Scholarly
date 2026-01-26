
import { searchCrossref } from '../electron/services/crossref';

async function test() {
    const testTitle = "Attention Is All You Need";
    console.log(`Searching for: ${testTitle}`);
    
    const result = await searchCrossref(testTitle);
    
    if (result) {
        console.log("Found metadata:");
        console.log("Title:", result.title);
        console.log("DOI:", result.DOI);
        console.log("Authors:", result.author);
        console.log("Published:", result.issued);
    } else {
        console.log("No metadata found.");
    }
}

test();
