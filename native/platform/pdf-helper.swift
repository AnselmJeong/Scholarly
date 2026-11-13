import Foundation
import PDFKit
import AppKit

struct Page: Codable { let pageNumber: Int; let text: String }
struct Document: Codable { let pageCount: Int; let pages: [Page] }
func fail(_ message: String) -> Never { FileHandle.standardError.write(Data(message.utf8)); exit(1) }
let args = CommandLine.arguments
 guard args.count >= 3, let pdf = PDFDocument(url: URL(fileURLWithPath: args[2])) else { fail("Cannot open this PDF.") }
if args[1] == "extract" {
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
