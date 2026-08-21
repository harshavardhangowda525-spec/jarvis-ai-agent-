/**
 * Safe arithmetic evaluator — a small recursive-descent parser. No `eval`,
 * no `Function`, no access to any runtime scope. Supports + - * / % ^,
 * parentheses, unary minus, `%` as a trailing "percent of" operator when it
 * multiplies (e.g. "25000 * 18%"), the constants pi/e, and a fixed set of
 * math functions.
 */

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "name"; v: string }
  | { t: "("; }
  | { t: ")"; }
  | { t: "%"; };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < s.length && /[0-9._]/.test(s[i])) num += s[i++];
      const value = Number(num.replace(/_/g, ""));
      if (Number.isNaN(value)) throw new Error(`Invalid number: ${num}`);
      tokens.push({ t: "num", v: value });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let name = "";
      while (i < s.length && /[a-zA-Z]/.test(s[i])) name += s[i++];
      tokens.push({ t: "name", v: name.toLowerCase() });
      continue;
    }
    if ("+-*/^".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") { tokens.push({ t: "(" }); i++; continue; }
    if (c === ")") { tokens.push({ t: ")" }); i++; continue; }
    if (c === "%") { tokens.push({ t: "%" }); i++; continue; }
    throw new Error(`Unexpected character: ${c}`);
  }
  return tokens;
}

export function evaluateExpression(input: string): number {
  if (!input || input.length > 200) throw new Error("Expression too long.");
  const tokens = tokenize(input);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // expr := term (('+' | '-') term)*
  function parseExpr(): number {
    let value = parseTerm();
    while (peek() && peek().t === "op" && ["+", "-"].includes((peek() as any).v)) {
      const op = (next() as any).v;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  // term := factor (('*' | '/') factor)*
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() && peek().t === "op" && ["*", "/"].includes((peek() as any).v)) {
      const op = (next() as any).v;
      const rhs = parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new Error("Division by zero.");
        value = value / rhs;
      } else {
        value = value * rhs;
      }
    }
    return value;
  }

  // factor := power ('%')?   — trailing % turns the value into a fraction
  function parseFactor(): number {
    let value = parsePower();
    while (peek() && peek().t === "%") {
      next();
      value = value / 100;
    }
    return value;
  }

  // power := unary ('^' factor)?
  function parsePower(): number {
    const base = parseUnary();
    if (peek() && peek().t === "op" && (peek() as any).v === "^") {
      next();
      const exp = parseFactor();
      return Math.pow(base, exp);
    }
    return base;
  }

  // unary := ('-' | '+')* atom
  function parseUnary(): number {
    if (peek() && peek().t === "op" && ["+", "-"].includes((peek() as any).v)) {
      const op = (next() as any).v;
      const v = parseUnary();
      return op === "-" ? -v : v;
    }
    return parseAtom();
  }

  // atom := num | name (const | function '(' expr ')') | '(' expr ')'
  function parseAtom(): number {
    const tok = peek();
    if (!tok) throw new Error("Unexpected end of expression.");
    if (tok.t === "num") { next(); return tok.v; }
    if (tok.t === "(") {
      next();
      const v = parseExpr();
      if (!peek() || peek().t !== ")") throw new Error("Missing closing parenthesis.");
      next();
      return v;
    }
    if (tok.t === "name") {
      next();
      const name = tok.v;
      if (name in CONSTANTS) return CONSTANTS[name];
      if (name in FUNCTIONS) {
        if (!peek() || peek().t !== "(") throw new Error(`Expected ( after ${name}`);
        next();
        const arg = parseExpr();
        if (!peek() || peek().t !== ")") throw new Error("Missing closing parenthesis.");
        next();
        return FUNCTIONS[name](arg);
      }
      throw new Error(`Unknown identifier: ${name}`);
    }
    throw new Error("Unexpected token in expression.");
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing input.");
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number.");
  return result;
}
