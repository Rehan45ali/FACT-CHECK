export async function extractTextFromPdf(buffer: ArrayBuffer | Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = buffer instanceof Buffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
  });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const words = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? "")
      .filter(Boolean);

    const text = words.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      pages.push(text);
    }
  }

  return pages.join("\n\n").trim();
}
