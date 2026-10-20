const GITHUB_PR_URL_REGEX =
  /(?<!\()\bhttps:\/\/github\.com\/daniel-mf-92\/primalfront\/pull\/(\d+)\b/g;
const GITHUB_COMPARE_URL_REGEX =
  /(?<!\()\bhttps:\/\/github\.com\/daniel-mf-92\/primalfront\/compare\/([\w.-]+)\b/g;
const GITHUB_MENTION_REGEX =
  /(^|[^\w/[`])@([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)(?![\w-])/gim;

export function normalizeNewsMarkdown(markdown: string): string {
  return (
    markdown
      // Convert bold header lines (e.g. "**Title**") into real Markdown headers.
      // Exclude lines starting with - or * to avoid converting bullet points.
      .replace(/^([^\-*\s].*?) \*\*(.+?)\*\*$/gm, "## $1 $2")
      .replace(
        GITHUB_PR_URL_REGEX,
        (_match, prNumber) =>
          `[#${prNumber}](https://github.com/daniel-mf-92/primalfront/pull/${prNumber})`,
      )
      .replace(
        GITHUB_COMPARE_URL_REGEX,
        (_match, comparison) =>
          `[${comparison}](https://github.com/daniel-mf-92/primalfront/compare/${comparison})`,
      )
      .replace(
        GITHUB_MENTION_REGEX,
        (_match, prefix, username) =>
          `${prefix}[@${username}](https://github.com/${username})`,
      )
  );
}
