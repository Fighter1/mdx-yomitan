import { readFileSync, writeFileSync } from "fs";
export function mergeCssFiles(files: string[], outputFile: string) {
  let merged = "";
  // (line endings normalised, so a Windows checkout builds the same zips as the release workflow)
  files.forEach(
    (file) => (merged += readFileSync(file, "utf-8").replaceAll("\r\n", "\n")),
  );
  writeFileSync(outputFile, merged);
}
