import { readFileSync } from "fs";

/** The stylesheets one after another, as one string. */
export function mergeCssFiles(files: string[]): string {
  // (line endings normalised, so a Windows checkout builds the same zips as the release workflow)
  return files
    .map((file) => readFileSync(file, "utf-8").replaceAll("\r\n", "\n"))
    .join("");
}
