// Developer smoke check: use the same system WebKit engine as the installed reader.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 2 else { fatalError("reader-check <HTML> [width] [font-size]") }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let width = args.count > 2 ? Double(args[2]) ?? 780 : 780
let fontSize = args.count > 3 ? Double(args[3]) ?? 17 : 17
let web = WKWebView(frame: CGRect(x:0,y:0,width:width,height:800))
final class Check: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.callAsyncJavaScript("""
        document.body.style.fontSize=fontSize+'px';
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode().catch(()=>{})));
        const images=[...document.querySelectorAll('main img')];
        const result={ready:window.noteReady===true,math:document.querySelectorAll('.katex').length,mathErrors:Number(document.documentElement.dataset.mathErrors||0),tables:document.querySelectorAll('table').length,images:images.length,brokenImages:images.filter(i=>!i.complete||i.naturalWidth===0).length,overflow:document.documentElement.scrollWidth>innerWidth+1,fonts:document.fonts.status};
        result.pairs=[...document.querySelectorAll('.visual-pair')].map(pair=>{
          const prose=pair.querySelector('.explanation'), figures=pair.querySelector('.visual-figures');
          const a=prose.getBoundingClientRect(), b=figures.getBoundingClientRect();
          return {labels:[...figures.querySelectorAll('figure')].map(f=>f.dataset.visual),explanation:prose.textContent.trim(),sideBySide:Math.abs(a.top-b.top)<1&&b.left>=a.right,stacked:b.top>=a.bottom&&Math.abs(a.left-b.left)<1,proseFirst:!!(prose.compareDocumentPosition(figures)&Node.DOCUMENT_POSITION_FOLLOWING),widths:[a.width,b.width]};
        });
        return JSON.stringify(result);
        """, arguments:["fontSize":fontSize], in:nil, in:.page) { result in
            switch result {
            case .success(let value): print(value); exit(0)
            case .failure(let error): fputs(error.localizedDescription,stderr); exit(1)
            }
        }
    }
}
let check = Check()
web.navigationDelegate = check
web.loadHTMLString(try String(contentsOfFile:args[1],encoding:.utf8),baseURL:nil)
DispatchQueue.main.asyncAfter(deadline:.now()+30) { fputs("WebKit check timed out",stderr);exit(2) }
app.run()
