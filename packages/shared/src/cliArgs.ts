export interface ParsedCliArgs {
  readonly flags: Record<string, string | null>;
  readonly positionals: string[];
}

export interface ParseCliArgsOptions {
  readonly booleanFlags?: readonly string[];
}

interface ParsedCliToken {
  readonly value: string;
  readonly quoted: boolean;
}

function tokenizeCliArgs(input: string): ParsedCliToken[] {
  const tokens: ParsedCliToken[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;
  let tokenQuoted = false;

  const pushCurrent = () => {
    if (!tokenStarted) {
      return;
    }
    tokens.push({ value: current, quoted: tokenQuoted });
    current = "";
    tokenStarted = false;
    tokenQuoted = false;
  };

  const trimmed = input.trim();
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]!;
    const nextChar = trimmed[index + 1];

    if (quote) {
      if (char === "\\" && nextChar !== undefined && (nextChar === quote || nextChar === "\\")) {
        const afterEscapedChar = trimmed[index + 2];
        const looksLikeQuotedWindowsPath =
          quote === '"' && nextChar === '"' && /^[A-Za-z]:\\/.test(current);
        if (
          looksLikeQuotedWindowsPath &&
          (afterEscapedChar === undefined || /\s/.test(afterEscapedChar))
        ) {
          current += "\\";
          tokenStarted = true;
          continue;
        }
        current += nextChar;
        tokenStarted = true;
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      } else {
        current += char;
        tokenStarted = true;
      }
      continue;
    }

    if (char === "\\") {
      const shouldUnescape =
        nextChar !== undefined &&
        (/\s/.test(nextChar) || nextChar === '"' || nextChar === "'" || nextChar === "\\");
      if (shouldUnescape) {
        current += nextChar;
        tokenStarted = true;
        index += 1;
      } else {
        current += "\\";
        tokenStarted = true;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      tokenStarted = true;
      tokenQuoted = true;
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  pushCurrent();
  return tokens;
}

/**
 * Parse CLI-style arguments into flags and positionals.
 *
 * Accepts a string (split by whitespace) or a pre-split argv array.
 * Supports `--key value`, `--key=value`, and `--flag` (boolean) syntax.
 *
 *   parseCliArgs("")
 *     → { flags: {}, positionals: [] }
 *
 *   parseCliArgs("--chrome")
 *     → { flags: { chrome: null }, positionals: [] }
 *
 *   parseCliArgs("--chrome --effort high")
 *     → { flags: { chrome: null, effort: "high" }, positionals: [] }
 *
 *   parseCliArgs("--effort=high")
 *     → { flags: { effort: "high" }, positionals: [] }
 *
 *   parseCliArgs(["1.2.3", "--root", "/path", "--github-output"], { booleanFlags: ["github-output"] })
 *     → { flags: { root: "/path", "github-output": null }, positionals: ["1.2.3"] }
 */
export function parseCliArgs(
  args: string | readonly string[],
  options?: ParseCliArgsOptions,
): ParsedCliArgs {
  const tokens =
    typeof args === "string"
      ? tokenizeCliArgs(args)
      : Array.from(args, (value) => ({ value, quoted: false }));
  const booleanSet = options?.booleanFlags ? new Set(options.booleanFlags) : undefined;

  const flags: Record<string, string | null> = {};
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const tokenValue = token.value;

    if (tokenValue.startsWith("--") && (!token.quoted || tokenValue.includes("="))) {
      const rest = tokenValue.slice(2);
      if (!rest) continue;

      // Handle --key=value syntax
      const eqIndex = rest.indexOf("=");
      if (eqIndex !== -1) {
        flags[rest.slice(0, eqIndex)] = rest.slice(eqIndex + 1);
        continue;
      }

      // Known boolean flag — never consumes next token
      if (booleanSet?.has(rest)) {
        flags[rest] = null;
        continue;
      }

      // Handle --key value or --flag (boolean)
      const next = tokens[i + 1];
      if (next !== undefined && (!next.value.startsWith("--") || next.quoted)) {
        flags[rest] = next.value;
        i++;
      } else {
        flags[rest] = null;
      }
    } else {
      positionals.push(tokenValue);
    }
  }

  return { flags, positionals };
}
