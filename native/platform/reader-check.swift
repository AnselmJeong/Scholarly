// Developer smoke check: use the same system WebKit engine as the installed reader.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 2 else { fatalError("reader-check <HTML> [width]") }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let width = args.count > 2 ? Double(args[2]) ?? 780 : 780
let web = WKWebView(frame: CGRect(x:0,y:0,width:width,height:800))
final class Check: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.callAsyncJavaScript("""
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode().catch(()=>{})));
        const images=[...document.querySelectorAll('main img')];
        const result={ready:window.noteReady===true,math:document.querySelectorAll('.katex').length,mathErrors:Number(document.documentElement.dataset.mathErrors||0),tables:document.querySelectorAll('table').length,images:images.length,brokenImages:images.filter(i=>!i.complete||i.naturalWidth===0).length,overflow:document.documentElement.scrollWidth>innerWidth+1,fonts:document.fonts.status};
        return JSON.stringify(result);
        """, arguments:[:], in:nil, in:.page) { result in
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
