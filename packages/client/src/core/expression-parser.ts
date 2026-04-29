import { NUMERIC_FIELDS, type NumericField } from './types';

// ─────── AST ───────

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'const'; name: 'PI' | 'E' }
  | { kind: 'field'; name: NumericField }
  | { kind: 'unary'; op: '-' | '+' | '!'; arg: Expr }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'ternary'; cond: Expr; whenTrue: Expr; whenFalse: Expr }
  | { kind: 'call'; name: BuiltinFn; args: Expr[] };

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '>' | '<' | '>=' | '<=' | '==' | '!='
  | '&&' | '||';

export type BuiltinFn = 'abs' | 'max' | 'min' | 'round' | 'floor' | 'ceil' | 'sqrt' | 'pow' | 'log' | 'exp';

const BUILTIN_ARITY: Record<BuiltinFn, [number, number]> = {
  abs: [1, 1], max: [1, Infinity], min: [1, Infinity], round: [1, 1],
  floor: [1, 1], ceil: [1, 1], sqrt: [1, 1], pow: [2, 2],
  log: [1, 1], exp: [1, 1],
};

const FIELD_SET: ReadonlySet<string> = new Set(NUMERIC_FIELDS);

// ─────── Tokenizer ───────

type TokenType =
  | 'num' | 'ident'
  | '+' | '-' | '*' | '/' | '%' | '(' | ')' | ','
  | '>' | '<' | '>=' | '<=' | '==' | '!=' | '!' | '&&' | '||'
  | '?' | ':' | 'eof';

interface Token {
  type: TokenType;
  value?: string | number;
  pos: number;
}

class Tokenizer {
  private i = 0;
  constructor(private src: string) {}

  next(): Token {
    this.skipWs();
    if (this.i >= this.src.length) return { type: 'eof', pos: this.i };
    const start = this.i;
    const c = this.src[this.i];

    // Numbers
    if (c >= '0' && c <= '9') {
      let s = '';
      while (this.i < this.src.length && /[0-9.]/.test(this.src[this.i])) {
        s += this.src[this.i++];
      }
      const n = Number(s);
      if (!Number.isFinite(n)) throw new Error(`Invalid number "${s}" at ${start}`);
      return { type: 'num', value: n, pos: start };
    }

    // Identifiers (fields, constants, builtin fns)
    if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      let s = '';
      while (this.i < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.i])) {
        s += this.src[this.i++];
      }
      return { type: 'ident', value: s, pos: start };
    }

    // Two-char operators
    const two = this.src.slice(this.i, this.i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
      this.i += 2;
      return { type: two as TokenType, pos: start };
    }

    // Single-char
    const single = '+-*/%()<>!,?:';
    if (single.includes(c)) {
      this.i++;
      return { type: c as TokenType, pos: start };
    }

    throw new Error(`Unexpected character "${c}" at ${start}`);
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++;
  }
}

// ─────── Parser (recursive descent) ───────
//
// Grammar (precedence low → high):
//   expr        = ternary
//   ternary     = logicalOr ( '?' ternary ':' ternary )?
//   logicalOr   = logicalAnd ( '||' logicalAnd )*
//   logicalAnd  = equality ( '&&' equality )*
//   equality    = comparison ( ('==' | '!=') comparison )*
//   comparison  = additive ( ('>' | '<' | '>=' | '<=') additive )*
//   additive    = multiplicative ( ('+' | '-') multiplicative )*
//   multiplicative = unary ( ('*' | '/' | '%') unary )*
//   unary       = ('-' | '+' | '!') unary | primary
//   primary     = NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'

class Parser {
  private cur: Token;
  constructor(private tk: Tokenizer) {
    this.cur = tk.next();
  }

  parse(): Expr {
    const e = this.ternary();
    if (this.cur.type !== 'eof') {
      throw new Error(`Unexpected token "${this.cur.type}" at ${this.cur.pos}`);
    }
    return e;
  }

  private eat(type: TokenType): Token {
    if (this.cur.type !== type) {
      throw new Error(`Expected ${type} but got ${this.cur.type} at ${this.cur.pos}`);
    }
    const t = this.cur;
    this.cur = this.tk.next();
    return t;
  }

  private ternary(): Expr {
    const cond = this.logicalOr();
    if (this.cur.type === '?') {
      this.eat('?');
      const whenTrue = this.ternary();
      this.eat(':');
      const whenFalse = this.ternary();
      return { kind: 'ternary', cond, whenTrue, whenFalse };
    }
    return cond;
  }

  private logicalOr(): Expr {
    let left = this.logicalAnd();
    while (this.cur.type === '||') {
      this.eat('||');
      const right = this.logicalAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }

  private logicalAnd(): Expr {
    let left = this.equality();
    while (this.cur.type === '&&') {
      this.eat('&&');
      const right = this.equality();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private equality(): Expr {
    let left = this.comparison();
    while (this.cur.type === '==' || this.cur.type === '!=') {
      const op = this.cur.type as '==' | '!=';
      this.eat(op);
      const right = this.comparison();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private comparison(): Expr {
    let left = this.additive();
    while (
      this.cur.type === '>' || this.cur.type === '<' ||
      this.cur.type === '>=' || this.cur.type === '<='
    ) {
      const op = this.cur.type as '>' | '<' | '>=' | '<=';
      this.eat(op);
      const right = this.additive();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.cur.type === '+' || this.cur.type === '-') {
      const op = this.cur.type as '+' | '-';
      this.eat(op);
      const right = this.multiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.cur.type === '*' || this.cur.type === '/' || this.cur.type === '%') {
      const op = this.cur.type as '*' | '/' | '%';
      this.eat(op);
      const right = this.unary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private unary(): Expr {
    if (this.cur.type === '-' || this.cur.type === '+' || this.cur.type === '!') {
      const op = this.cur.type as '-' | '+' | '!';
      this.eat(op);
      const arg = this.unary();
      return { kind: 'unary', op, arg };
    }
    return this.primary();
  }

  private primary(): Expr {
    if (this.cur.type === 'num') {
      const t = this.cur;
      this.eat('num');
      return { kind: 'num', value: t.value as number };
    }
    if (this.cur.type === '(') {
      this.eat('(');
      const e = this.ternary();
      this.eat(')');
      return e;
    }
    if (this.cur.type === 'ident') {
      const name = this.cur.value as string;
      const pos = this.cur.pos;
      this.eat('ident');

      // Function call?
      if ((this.cur as Token).type === '(') {
        this.eat('(');
        const args: Expr[] = [];
        if ((this.cur as Token).type !== ')') {
          args.push(this.ternary());
          while ((this.cur as Token).type === ',') {
            this.eat(',');
            args.push(this.ternary());
          }
        }
        this.eat(')');
        if (!(name in BUILTIN_ARITY)) {
          throw new Error(`Unknown function "${name}" at ${pos}`);
        }
        const [minA, maxA] = BUILTIN_ARITY[name as BuiltinFn];
        if (args.length < minA || args.length > maxA) {
          throw new Error(
            `${name}() expects ${minA}${maxA === Infinity ? '+' : `..${maxA}`} args, got ${args.length} at ${pos}`,
          );
        }
        return { kind: 'call', name: name as BuiltinFn, args };
      }

      // Constant or field ref
      if (name === 'PI' || name === 'E') {
        return { kind: 'const', name };
      }
      if (FIELD_SET.has(name)) {
        return { kind: 'field', name: name as NumericField };
      }
      throw new Error(`Unknown identifier "${name}" at ${pos}`);
    }
    throw new Error(`Unexpected token "${this.cur.type}" at ${this.cur.pos}`);
  }
}

export function parseExpression(src: string): Expr {
  return new Parser(new Tokenizer(src)).parse();
}

// Walk an AST and collect all referenced fields.
export function extractDependencies(expr: Expr): NumericField[] {
  const out = new Set<NumericField>();
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'field': out.add(e.name); break;
      case 'unary': walk(e.arg); break;
      case 'binary': walk(e.left); walk(e.right); break;
      case 'ternary': walk(e.cond); walk(e.whenTrue); walk(e.whenFalse); break;
      case 'call': for (const a of e.args) walk(a); break;
      case 'num': case 'const': break;
    }
  };
  walk(expr);
  return [...out];
}
