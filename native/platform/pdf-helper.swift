import Foundation
import PDFKit
import AppKit

struct Page: Codable { let pageNumber: Int; let text: String }
struct Document: Codable { let pageCount: Int; let pages: [Page] }
struct Line: Codable { let text: String; let rect: [Double] }
struct Drawing: Codable { let kind: String; let rect: [Double] }
final class DrawingScan {
    var transform = CGAffineTransform.identity
    var stack: [CGAffineTransform] = []
    var path = CGRect.null
    var drawings: [(String,CGRect)] = []
    var depth = 0
    func point(_ x: Double, _ y: Double) {
        let p = CGPoint(x:x,y:y).applying(transform)
        path = path.union(CGRect(x:p.x,y:p.y,width:0.001,height:0.001))
    }
    func paint() { if !path.isNull && drawings.count < 100000 { drawings.append(("path",path)) };path = .null }
}
func scanContext(_ info: UnsafeMutableRawPointer?) -> DrawingScan { Unmanaged<DrawingScan>.fromOpaque(info!).takeUnretainedValue() }
func popNumbers(_ scanner: CGPDFScannerRef, _ count: Int) -> [Double]? {
    var result:[Double]=[]
    for _ in 0..<count { var value:CGPDFReal=0;guard CGPDFScannerPopNumber(scanner,&value) else {return nil};result.append(Double(value)) }
    return result.reversed()
}
func scanDrawingStream(_ stream: CGPDFContentStreamRef, _ state: DrawingScan) {
    guard state.depth < 12, let table=CGPDFOperatorTableCreate() else { return }
    defer { CGPDFOperatorTableRelease(table) }
    CGPDFOperatorTableSetCallback(table,"q") { _,info in let s=scanContext(info);s.stack.append(s.transform) }
    CGPDFOperatorTableSetCallback(table,"Q") { _,info in let s=scanContext(info);s.transform=s.stack.popLast() ?? .identity }
    CGPDFOperatorTableSetCallback(table,"cm") { scanner,info in
        guard let a=popNumbers(scanner,6) else {return};let s=scanContext(info)
        s.transform=CGAffineTransform(a:a[0],b:a[1],c:a[2],d:a[3],tx:a[4],ty:a[5]).concatenating(s.transform)
    }
    for op in ["m","l"] { CGPDFOperatorTableSetCallback(table,op) { scanner,info in
        guard let a=popNumbers(scanner,2) else{return};scanContext(info).point(a[0],a[1])
    } }
    CGPDFOperatorTableSetCallback(table,"c") { scanner,info in
        guard let a=popNumbers(scanner,6) else{return};let s=scanContext(info);for i in stride(from:0,to:6,by:2) {s.point(a[i],a[i+1])}
    }
    for op in ["v","y"] { CGPDFOperatorTableSetCallback(table,op) { scanner,info in
        guard let a=popNumbers(scanner,4) else{return};let s=scanContext(info);s.point(a[0],a[1]);s.point(a[2],a[3])
    } }
    CGPDFOperatorTableSetCallback(table,"re") { scanner,info in
        guard let a=popNumbers(scanner,4) else{return};let s=scanContext(info)
        s.path=s.path.union(CGRect(x:a[0],y:a[1],width:a[2],height:a[3]).standardized.applying(s.transform))
    }
    for op in ["S","s","f","F","f*","B","B*","b","b*"] { CGPDFOperatorTableSetCallback(table,op) { _,info in scanContext(info).paint() } }
    CGPDFOperatorTableSetCallback(table,"n") { _,info in scanContext(info).path = .null }
    CGPDFOperatorTableSetCallback(table,"Do") { scanner,info in
        let s=scanContext(info);var name:UnsafePointer<CChar>?
        guard CGPDFScannerPopName(scanner,&name),let name,
              let object=CGPDFContentStreamGetResource(CGPDFScannerGetContentStream(scanner),"XObject",name) else{return}
        var objectStream:CGPDFStreamRef?
        guard CGPDFObjectGetValue(object,.stream,&objectStream),let objectStream,
              let dictionary=CGPDFStreamGetDictionary(objectStream) else{return}
        var subtype:UnsafePointer<CChar>?
        guard CGPDFDictionaryGetName(dictionary,"Subtype",&subtype),let subtype else{return}
        if String(cString:subtype)=="Image" {
            if s.drawings.count < 100000 { s.drawings.append(("image",CGRect(x:0,y:0,width:1,height:1).applying(s.transform))) }
        } else if String(cString:subtype)=="Form" {
            var resources:CGPDFDictionaryRef?
            CGPDFDictionaryGetDictionary(dictionary,"Resources",&resources)
            let child=DrawingScan();child.transform=s.transform;child.depth=s.depth+1
            var matrix:CGPDFArrayRef?
            if CGPDFDictionaryGetArray(dictionary,"Matrix",&matrix),let matrix,CGPDFArrayGetCount(matrix)==6 {
                var a=[CGPDFReal](repeating:0,count:6)
                for i in 0..<6 {CGPDFArrayGetNumber(matrix,i,&a[i])}
                child.transform=CGAffineTransform(a:a[0],b:a[1],c:a[2],d:a[3],tx:a[4],ty:a[5]).concatenating(child.transform)
            }
            // A form without its own Resources inherits the parent content stream.
            let childStream=CGPDFContentStreamCreateWithStream(objectStream,resources ?? dictionary,CGPDFScannerGetContentStream(scanner))
            scanDrawingStream(childStream,child);CGPDFContentStreamRelease(childStream)
            s.drawings.append(contentsOf:child.drawings.prefix(max(0,100000-s.drawings.count)))
        }
    }
    let scanner=CGPDFScannerCreate(stream,table,Unmanaged.passUnretained(state).toOpaque())
    CGPDFScannerScan(scanner);CGPDFScannerRelease(scanner)
}
func drawings(_ page: PDFPage) -> [Drawing] {
    guard let reference=page.pageRef else {return []}
    let stream=CGPDFContentStreamCreateWithPage(reference);defer {CGPDFContentStreamRelease(stream)}
    let state=DrawingScan();scanDrawingStream(stream,state)
    let bounds=page.bounds(for:.mediaBox)
    return state.drawings.compactMap { kind,r in
        let r=r.intersection(bounds)
        if r.isNull || r.width*r.height > bounds.width*bounds.height*0.95 {return nil}
        return Drawing(kind:kind,rect:[r.minX/bounds.width,(bounds.maxY-r.maxY)/bounds.height,r.width/bounds.width,r.height/bounds.height])
    }
}
struct Visual: Codable { let label: String; let kind: String; let number: String; let page: Int; let caption: String; let rect: [Double]; let cropped: Bool }
func rectangle(_ values: [Double]) -> CGRect { CGRect(x:values[0],y:values[1],width:values[2],height:values[3]) }
func visualRegion(kind: String, anchor: CGRect, captionBottom: Double, captionRight: Double, all: [Line], marks: [Drawing], boundaries: [Double]) -> CGRect? {
    let before = boundaries.filter {$0 < anchor.minY-0.005}.max() ?? 0.035
    let after = boundaries.filter {$0 > anchor.minY+0.005}.min() ?? 0.96
    if kind == "table" {
        // Cell-by-cell grids emit short segments: join contiguous collinear edges first.
        var segments: [CGRect] = []
        let tableEnd: CGFloat = min(after,0.935)
        for mark in marks {
            let r=rectangle(mark.rect)
            if r.width>0.025 && r.height<0.004 && r.minY>before && r.maxY<tableEnd { segments.append(r) }
        }
        segments.sort { a,b in
            if abs(a.minY-b.minY)<0.001 { return a.minX<b.minX }
            return a.minY<b.minY
        }
        var joined: [CGRect] = []
        for segment in segments {
            if let last=joined.last, abs(last.minY-segment.minY)<0.001, segment.minX<last.maxX+0.003 {
                joined[joined.count-1]=last.union(segment)
            } else {joined.append(segment)}
        }
        let rules = joined.filter {$0.width>0.17 && abs($0.minX-anchor.minX)<0.08}
        var region=CGRect.null
        if let nearest = rules.min(by:{ abs($0.midY-anchor.minY) < abs($1.midY-anchor.minY) }), abs(nearest.midY-anchor.minY)<0.18 {
            let group = rules.filter {abs($0.minX-nearest.minX)<0.018 && abs($0.width-nearest.width)<0.03}
            if group.count>=2 { region=group.reduce(CGRect.null) {$0.union($1)} }
        }
        // Some PDFs paint an entire grid as one path rather than separate rules.
        if region.isNull || region.height<0.022 {
            func gridDistance(_ r: CGRect) -> CGFloat { min(abs(r.maxY-anchor.minY),abs(r.minY-CGFloat(captionBottom))) }
            var bestDistance: CGFloat = 0.08
            for mark in marks {
                let r = rectangle(mark.rect)
                guard r.width > 0.25, r.height > 0.025, abs(r.minX-anchor.minX) < 0.08 else {continue}
                guard r.minY > before, r.maxY < min(after,0.935) else {continue}
                let distance = gridDistance(r)
                if distance < bestDistance { region=r;bestDistance=distance }
            }
        }
        guard !region.isNull, region.height > 0.022 else {return nil}
        let below=region.midY>anchor.midY
        if below { region=region.union(CGRect(x:region.minX,y:anchor.minY,width:region.width,height:anchor.height)) }
        // Keep the original table's footnotes, but stop before the following prose.
        let ordered=all.filter {let r=rectangle($0.rect);return r.minX>=region.minX-0.01 && r.maxX<=region.maxX+0.015 && r.minY>=region.maxY-0.002 && r.minY<after}.sorted {$0.rect[1]<$1.rect[1]}
        var footnote=false
        for line in ordered {
            let r=rectangle(line.rect)
            if r.minY>region.maxY+0.018 || r.minY>0.935 || line.text.range(of:"^\\d+$",options:.regularExpression) != nil {break}
            if line.text.range(of:"^(Notes?:|Abbreviations?:|[∗*†‡]|[a-z]\\s)",options:.regularExpression) != nil {footnote=true}
            if !footnote || line.text.range(of:"^\\d+\\.\\d+",options:.regularExpression) != nil {break}
            region=region.union(r)
        }
        return region.insetBy(dx:-0.006,dy:-0.006)
    }
    // Use actual PDF image/path geometry. A page screenshot is never labelled as a figure.
    let candidates=marks.filter {
        let r=rectangle($0.rect)
        return r.width>0.002 && r.height>0.002 && r.midY>before && r.maxY<anchor.minY+0.003 && r.minY>0.035 && r.maxY>0.09 && r.width*r.height<0.86 && (anchor.minX<0.45 || r.midX>0.45)
    }
    var region=CGRect.null
    var sideways=false
    var sideEnd=after
    let images=candidates.filter {$0.kind=="image" && $0.rect[2]>0.12 && $0.rect[3]>0.06}
    for mark in candidates {region=region.union(rectangle(mark.rect))}
    if region.isNull || region.height<0.055 {
        // Some journals put the caption beside a plot, or above it.
        for mark in marks {
            let r=rectangle(mark.rect)
            if r.width>0.6 && r.height<0.004 && r.minY>captionBottom+0.02 { sideEnd=min(sideEnd,r.minY) }
        }
        let beside=marks.filter { let r=rectangle($0.rect);return r.width>0.002 && r.height>0.002 && r.minX>captionRight+0.015 && r.minY>anchor.minY-0.025 && r.maxY<sideEnd }
        sideways = !beside.isEmpty
        for mark in beside {region=region.union(rectangle(mark.rect))}
        if region.isNull || region.height<0.055 {
            let below=marks.filter {let r=rectangle($0.rect);return $0.kind=="image" && r.width>0.15 && r.height>0.06 && r.minY>=captionBottom-0.005 && r.minY<captionBottom+0.05 && r.maxY<after}
            region=below.reduce(CGRect.null) {$0.union(rectangle($1.rect))}
        }
    }
    guard !region.isNull,region.width>0.14,region.height>0.055 else {return nil}
    // Outlined letters are paths, not selectable PDF text. Include nearby glyphs
    // without admitting distant page headers or the first line of the caption.
    for _ in 0..<2 {
        let expanded=region.insetBy(dx:-0.018,dy:-0.018)
        for mark in marks {
            let r=rectangle(mark.rect)
            let within = sideways ? r.minX>captionRight+0.01 && r.maxY<sideEnd : r.maxY<anchor.minY-0.003
            if r.width<0.2 && r.height<0.05 && r.minY>max(before,0.04) && within && r.intersects(expanded) {region=region.union(r)}
        }
    }
    // Tick labels and panel letters often live outside the vector paths. Grow over
    // neighbouring short text runs, within this figure's caption boundaries only.
    for _ in 0..<2 {
        let expanded=region.insetBy(dx:-0.035,dy:-0.022)
        for line in all {
            let r=rectangle(line.rect)
            let nearbyProse=all.filter {let p=rectangle($0.rect);return abs(p.minX-r.minX)<0.025 && abs(p.minY-r.minY)<0.05 && p.width>0.27 && $0.text.split(separator:" ").count>=7}.count>=2
            let label=line.text.count<(images.isEmpty ? 55 : 18) && !nearbyProse
            let within = sideways ? r.minX>captionRight+0.01 && r.maxY<sideEnd : r.maxY<anchor.minY-0.002
            if label && r.minY>before && within && r.intersects(expanded) && r.minY>0.04 {region=region.union(r)}
        }
    }
    let padded=region.insetBy(dx:-0.007,dy:-0.007)
    return sideways ? padded : padded.intersection(CGRect(x:0,y:0,width:1,height:anchor.minY-0.003))
}
func visuals(_ page: PDFPage, _ number: Int) -> [Visual] {
    let all = lines(page).sorted { $0.rect[1] < $1.rect[1] }
    let pattern = try! NSRegularExpression(pattern: "^(Figure|Fig\\.|FIGURE|FIG\\.|Table|TABLE)\\s*([Ss]?\\d+)(?:\\s*[.:|–—]|$)(?:\\s|$)")
    let anchors=all.filter {pattern.firstMatch(in:$0.text,range:NSRange($0.text.startIndex...,in:$0.text)) != nil}
    if anchors.isEmpty {return []}
    let marks=drawings(page)
    var found: [Visual] = []
    for line in all {
        guard let match = pattern.firstMatch(in: line.text, range: NSRange(line.text.startIndex..., in: line.text)),
              let kindRange = Range(match.range(at: 1), in: line.text), let numberRange = Range(match.range(at: 2), in: line.text) else { continue }
        let kind = line.text[kindRange].lowercased().hasPrefix("tab") ? "table" : "figure"
        let labelNumber = String(line.text[numberRange]).uppercased()
        // Captions may be separate PDF text runs. Collect only the contiguous caption band.
        var band = [line]
        if line.text.count < 25 {
            let continuations = all.filter { abs($0.rect[1]-line.rect[1]) < 0.006 && $0.rect[0] > line.rect[0] }.sorted { $0.rect[0] < $1.rect[0] }
            var right = line.rect[0]+line.rect[2]
            for next in continuations {
                if next.rect[0]-right > 0.025 { break }
                band.append(next); right = next.rect[0]+next.rect[2]
            }
        }
        let captionRight = band.map { $0.rect[0]+$0.rect[2] }.max() ?? 1
        let columnRight = captionRight < 0.53 ? 0.53 : 1.0
        var bottom = line.rect[1]+line.rect[3]
        for next in all where next.rect[1] > line.rect[1]+0.006 && next.rect[0] >= line.rect[0]-0.015 && next.rect[0]+next.rect[2] <= columnRight+0.005 {
            if next.rect[1] > bottom+0.009 { break }
            if next.text.count > 20 {
                band.append(next); bottom=max(bottom,next.rect[1]+next.rect[3])
            }
        }
        band.sort { abs($0.rect[1]-$1.rect[1]) < 0.006 ? $0.rect[0] < $1.rect[0] : $0.rect[1] < $1.rect[1] }
        let caption = band.map(\.text).joined(separator:" ")
        var rect = [0.0,0.0,1.0,1.0]
        var cropped = false
        if let region=visualRegion(kind:kind,anchor:rectangle(line.rect),captionBottom:bottom,captionRight:captionRight,all:all,marks:marks,boundaries:anchors.map {$0.rect[1]}) {
            let r=region.intersection(CGRect(x:0,y:0,width:1,height:1))
            if r.width*r.height<0.88 {rect=[r.minX,r.minY,r.width,r.height];cropped=true}
        }
        if !found.contains(where: { $0.kind == kind && $0.number == labelNumber }) {
            found.append(Visual(label: "\(kind == "table" ? "Table" : "Figure") \(labelNumber)", kind:kind, number:labelNumber, page:number, caption:caption, rect:rect, cropped:cropped))
        }
    }
    return found
}
func lines(_ page: PDFPage) -> [Line] {
    let bounds = page.bounds(for: .mediaBox)
    return (page.selection(for: bounds)?.selectionsByLine() ?? []).compactMap { selection in
        guard let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        let r = selection.bounds(for: page)
        return Line(text: text, rect: [r.minX / bounds.width, (bounds.maxY-r.maxY) / bounds.height, r.width / bounds.width, r.height / bounds.height])
    }
}
func fail(_ message: String) -> Never { FileHandle.standardError.write(Data(message.utf8)); exit(1) }
let args = CommandLine.arguments
 guard args.count >= 3, let pdf = PDFDocument(url: URL(fileURLWithPath: args[2])) else { fail("Cannot open this PDF.") }
if args[1] == "visuals" {
    let found = (0..<pdf.pageCount).flatMap { n in pdf.page(at:n).map { visuals($0,n+1) } ?? [] }
    FileHandle.standardOutput.write(try JSONEncoder().encode(found))
} else if args[1] == "drawings" {
    guard args.count > 3, let n=Int(args[3]),let page=pdf.page(at:n-1) else {fail("Invalid page number.")}
    FileHandle.standardOutput.write(try JSONEncoder().encode(drawings(page)))
} else if args[1] == "layout" {
    guard args.count > 3, let n = Int(args[3]), let page = pdf.page(at: n-1) else { fail("Invalid page number.") }
    FileHandle.standardOutput.write(try JSONEncoder().encode(lines(page)))
} else if args[1] == "extract" {
    let pages = (0..<pdf.pageCount).map { Page(pageNumber: $0 + 1, text: pdf.page(at: $0)?.string ?? "") }
    FileHandle.standardOutput.write(try JSONEncoder().encode(Document(pageCount: pdf.pageCount, pages: pages)))
} else if args[1] == "page" || args[1] == "crop" {
    guard args.count >= 5, let n = Int(args[3]), n > 0, let page = pdf.page(at: n-1) else { fail("Invalid page number.") }
    let bounds = page.bounds(for: .mediaBox)
    let image = page.thumbnail(of: NSSize(width: 1500, height: 1500 * bounds.height / bounds.width), for: .mediaBox)
    guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { fail("Cannot render this page.") }
    var rendered = bitmap
    if args[1] == "crop" {
        guard args.count >= 9, let x = Double(args[5]), let y = Double(args[6]), let w = Double(args[7]), let h = Double(args[8]), [x,y,w,h].allSatisfy({$0.isFinite && $0 >= 0 && $0 <= 1}), w > 0, h > 0, x+w <= 1.001, y+h <= 1.001, let cg = bitmap.cgImage else {fail("Invalid crop.")}
        let region = CGRect(x:x*Double(cg.width),y:y*Double(cg.height),width:w*Double(cg.width),height:h*Double(cg.height)).integral.intersection(CGRect(x:0,y:0,width:cg.width,height:cg.height))
        guard let cropped = cg.cropping(to: region) else {fail("Cannot crop page.")}
        rendered = NSBitmapImageRep(cgImage: cropped)
    }
    guard let png = rendered.representation(using: .png, properties: [:]) else {fail("Cannot save page.")}
    try png.write(to: URL(fileURLWithPath: args[4]), options: .atomic)
} else { fail("Unknown PDF operation.") }
