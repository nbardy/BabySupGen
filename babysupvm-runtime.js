// SupVM.ts
// ========
// A tiny evaluator for the HVM subset used by InsertGen_hardcoded.hvm.
// Sup-fork captures are the only DUP form needed by that file. SupVM gives
// them the same observable branch correlation through a labelled-choice map,
// and charges captured variables as DUP-like interactions.
// Constructors
// ============
// Creates a variable term.
function Var(nam) {
    return { $: "Var", nam };
}
// Creates a reference term.
function Ref(nam) {
    return { $: "Ref", nam };
}
// Creates a lambda term.
function Lam(nam, bod) {
    return { $: "Lam", nam, bod };
}
// Creates an application term.
function App(fun, arg) {
    return { $: "App", fun, arg };
}
// Creates a match term.
function Mat(css) {
    return { $: "Mat", css };
}
// Creates a constructor term.
function Ctr(nam, fds) {
    return { $: "Ctr", nam, fds };
}
// Creates a numeric term.
function Num(val) {
    return { $: "Num", val };
}
// Creates an eraser term.
function Era() {
    return { $: "Era" };
}
// Creates a superposition term.
function Sup(lab, lft, rgt, cap) {
    return { $: "Sup", lab, lft, rgt, cap };
}
// Creates a let term.
function Let(nam, val, bod) {
    return { $: "Let", nam, val, bod };
}
// Creates a numeric addition term.
function Add(lft, rgt) {
    return { $: "Add", lft, rgt };
}
// Creates a numeric subtraction term.
function Sub(lft, rgt) {
    return { $: "Sub", lft, rgt };
}
// Creates a numeric multiplication term.
function Mul(lft, rgt) {
    return { $: "Mul", lft, rgt };
}
// Creates a numeric integer division term.
function Div(lft, rgt) {
    return { $: "Div", lft, rgt };
}
// Creates a numeric modulo term.
function Mod(lft, rgt) {
    return { $: "Mod", lft, rgt };
}
// Creates an equality term.
function Eql(lft, rgt) {
    return { $: "Eql", lft, rgt };
}
// Creates a numeric less-than-or-equal term.
function Leq(lft, rgt) {
    return { $: "Leq", lft, rgt };
}
// Creates an and term.
function And(lft, rgt) {
    return { $: "And", lft, rgt };
}
// Creates a term suspension.
function Sterm(term, env) {
    return { $: "Term", term, env };
}
// Creates a value suspension.
function Sval(val) {
    return { $: "Val", val };
}
// Creates an application suspension.
function Sapp(fun, arg) {
    return { $: "App", fun, arg };
}
// Creates a numeric addition suspension.
function Sadd(lft, rgt) {
    return { $: "Add", lft, rgt };
}
// Creates a numeric subtraction suspension.
function Ssub(lft, rgt) {
    return { $: "Sub", lft, rgt };
}
// Creates a numeric multiplication suspension.
function Smul(lft, rgt) {
    return { $: "Mul", lft, rgt };
}
// Creates a numeric integer division suspension.
function Sdiv(lft, rgt) {
    return { $: "Div", lft, rgt };
}
// Creates a numeric modulo suspension.
function Smod(lft, rgt) {
    return { $: "Mod", lft, rgt };
}
// Creates an equality suspension.
function Seql(lft, rgt) {
    return { $: "Eql", lft, rgt };
}
// Creates a numeric less-than-or-equal suspension.
function Sleq(lft, rgt) {
    return { $: "Leq", lft, rgt };
}
// Creates an and suspension.
function Sand(lft, rgt) {
    return { $: "And", lft, rgt };
}
// Creates a many-field equality suspension.
function Smany(lft, rgt, idx) {
    return { $: "Many", lft, rgt, idx };
}
// Creates a normal variable.
function NVar(nam) {
    return { $: "Var", nam };
}
// Creates a normal lambda.
function NLam(nam, bod) {
    return { $: "Lam", nam, bod };
}
// Creates a normal application.
function NApp(fun, arg) {
    return { $: "App", fun, arg };
}
// Creates a normal match.
function NMat(css) {
    return { $: "Mat", css };
}
// Creates a normal constructor.
function NCtr(nam, fds) {
    return { $: "Ctr", nam, fds };
}
// Creates a normal number.
function NNum(val) {
    return { $: "Num", val };
}
// Source preprocessing
// ====================
// Removes line comments from a source file.
function strip_comments(src) {
    var out = "";
    var lin = src.split(/\r?\n/g);
    for (var idx = 0; idx < lin.length; idx++) {
        var row = lin[idx];
        var cut = row.indexOf("//");
        if (cut >= 0) {
            row = row.slice(0, cut);
        }
        out += row + "\n";
    }
    return out;
}
// Parser utilities
// ================
// Returns the current character.
function peek(ps) {
    return ps.src[ps.pos] || "";
}
// Returns a character at an offset.
function peek_at(ps, off) {
    return ps.src[ps.pos + off] || "";
}
// Tests whether parsing reached the end.
function at_end(ps) {
    return ps.pos >= ps.src.length;
}
// Skips whitespace.
function skip(ps) {
    while (!at_end(ps) && /\s/.test(peek(ps))) {
        ps.pos += 1;
    }
}
// Tests whether the source starts with a string.
function starts(ps, txt) {
    return ps.src.startsWith(txt, ps.pos);
}
// Consumes a string if present.
function match(ps, txt) {
    skip(ps);
    if (!starts(ps, txt)) {
        return false;
    }
    ps.pos += txt.length;
    return true;
}
// Consumes a required string.
function consume(ps, txt) {
    skip(ps);
    if (!starts(ps, txt)) {
        throw new Error("expected '" + txt + "' at byte " + ps.pos);
    }
    ps.pos += txt.length;
}
// Tests whether a character can start a name.
function is_name_start(chr) {
    return /^[A-Za-z_$]$/.test(chr);
}
// Tests whether a character can continue a name.
function is_name_char(chr) {
    return /^[A-Za-z0-9_$]$/.test(chr);
}
// Parses a name.
function parse_name(ps) {
    skip(ps);
    var chr = peek(ps);
    if (!is_name_start(chr)) {
        throw new Error("expected name at byte " + ps.pos);
    }
    var beg = ps.pos;
    ps.pos += 1;
    while (is_name_char(peek(ps))) {
        ps.pos += 1;
    }
    return ps.src.slice(beg, ps.pos);
}
// Program parser
// ==============
// Parses a complete program.
function parse_program(src) {
    var ps = { src: strip_comments(src), pos: 0 };
    var bk = new Map();
    while (true) {
        skip(ps);
        if (at_end(ps)) {
            return bk;
        }
        consume(ps, "@");
        var nam = parse_name(ps);
        consume(ps, "=");
        var val = parse_term(ps);
        bk.set(nam, val);
    }
}
// Term parser
// ===========
// Parses a term.
function parse_term(ps) {
    return parse_eql(ps);
}
// Parses equality.
function parse_eql(ps) {
    var lhs = parse_cons(ps);
    skip(ps);
    if (starts(ps, "===")) {
        ps.pos += 3;
        var rhs = parse_eql(ps);
        return Eql(lhs, rhs);
    }
    if (starts(ps, "<=")) {
        ps.pos += 2;
        var rhs = parse_eql(ps);
        return Leq(lhs, rhs);
    }
    return lhs;
}
// Parses cons syntax.
function parse_cons(ps) {
    var lhs = parse_add(ps);
    skip(ps);
    if (starts(ps, "<>")) {
        ps.pos += 2;
        var rhs = parse_term(ps);
        return Ctr("Cons", [lhs, rhs]);
    }
    return lhs;
}
// Parses numeric addition and subtraction.
function parse_add(ps) {
    var out = parse_mul(ps);
    while (true) {
        skip(ps);
        if (starts(ps, "+")) {
            ps.pos += 1;
            out = Add(out, parse_mul(ps));
            continue;
        }
        if (starts(ps, "-") && !/^[0-9]$/.test(peek_at(ps, 1))) {
            ps.pos += 1;
            out = Sub(out, parse_mul(ps));
            continue;
        }
        return out;
    }
}
// Parses numeric multiplication, integer division, and modulo.
function parse_mul(ps) {
    var out = parse_post(ps);
    while (true) {
        skip(ps);
        if (starts(ps, "*")) {
            ps.pos += 1;
            out = Mul(out, parse_post(ps));
            continue;
        }
        if (starts(ps, "/")) {
            ps.pos += 1;
            out = Div(out, parse_post(ps));
            continue;
        }
        if (starts(ps, "%")) {
            ps.pos += 1;
            out = Mod(out, parse_post(ps));
            continue;
        }
        return out;
    }
}
// Parses postfix function calls.
function parse_post(ps) {
    var out = parse_atom(ps);
    while (true) {
        skip(ps);
        if (!starts(ps, "(")) {
            return out;
        }
        ps.pos += 1;
        skip(ps);
        if (starts(ps, ")")) {
            ps.pos += 1;
            continue;
        }
        while (true) {
            var arg = parse_term(ps);
            out = App(out, arg);
            skip(ps);
            if (starts(ps, ",")) {
                ps.pos += 1;
                skip(ps);
            }
            if (starts(ps, ")")) {
                ps.pos += 1;
                break;
            }
        }
    }
}
// Parses an atomic term.
function parse_atom(ps) {
    skip(ps);
    var chr = peek(ps);
    if (chr === "λ") {
        ps.pos += 1;
        return parse_lam(ps);
    }
    if (chr === "!") {
        ps.pos += 1;
        return parse_let(ps);
    }
    if (chr === "&") {
        ps.pos += 1;
        return parse_sup(ps);
    }
    if (chr === "@") {
        ps.pos += 1;
        return Ref(parse_name(ps));
    }
    if (chr === "(") {
        ps.pos += 1;
        var trm = parse_term(ps);
        consume(ps, ")");
        return trm;
    }
    if (chr === "[") {
        return parse_list(ps);
    }
    if (/^[0-9]$/.test(chr) || (chr === "-" && /^[0-9]$/.test(peek_at(ps, 1)))) {
        return parse_num_or_nat(ps);
    }
    return Var(parse_name(ps));
}
// Parses a lambda or lambda-match body.
function parse_lam(ps) {
    skip(ps);
    if (starts(ps, "{")) {
        return parse_matcher(ps);
    }
    var nms = [];
    while (true) {
        skip(ps);
        if (starts(ps, "&")) {
            ps.pos += 1;
        }
        nms.push(parse_name(ps));
        skip(ps);
        if (starts(ps, ",")) {
            ps.pos += 1;
            continue;
        }
        consume(ps, ".");
        break;
    }
    var bod = parse_term(ps);
    for (var idx = nms.length - 1; idx >= 0; idx--) {
        bod = Lam(nms[idx], bod);
    }
    return bod;
}
// Parses a lambda-match term.
function parse_matcher(ps) {
    consume(ps, "{");
    var css = [];
    while (true) {
        skip(ps);
        if (starts(ps, "}")) {
            ps.pos += 1;
            return Mat(css);
        }
        var cse = parse_case(ps);
        css.push(cse);
        skip(ps);
        if (starts(ps, ";")) {
            ps.pos += 1;
        }
    }
}
// Parses one match case.
function parse_case(ps) {
    skip(ps);
    if (starts(ps, "[]")) {
        ps.pos += 2;
        consume(ps, ":");
        return { $: "Ctr", nam: "Nil", bod: parse_term(ps) };
    }
    if (starts(ps, "<>")) {
        ps.pos += 2;
        consume(ps, ":");
        return { $: "Ctr", nam: "Cons", bod: parse_term(ps) };
    }
    var num = parse_digits(ps);
    if (starts(ps, "n")) {
        ps.pos += 1;
        if (num === 1 && starts(ps, "+")) {
            ps.pos += 1;
            consume(ps, ":");
            return { $: "Ctr", nam: "Succ", bod: parse_term(ps) };
        }
        if (num === 0) {
            consume(ps, ":");
            return { $: "Ctr", nam: "Zero", bod: parse_term(ps) };
        }
        throw new Error("unsupported nat match at byte " + ps.pos);
    }
    consume(ps, ":");
    return { $: "Num", val: num, bod: parse_term(ps) };
}
// Parses a non-empty digit sequence.
function parse_digits(ps) {
    skip(ps);
    var beg = ps.pos;
    if (peek(ps) === "-" && /^[0-9]$/.test(peek_at(ps, 1))) {
        ps.pos += 1;
    }
    while (/^[0-9]$/.test(peek(ps))) {
        ps.pos += 1;
    }
    if (beg === ps.pos) {
        throw new Error("expected number at byte " + ps.pos);
    }
    return Number(ps.src.slice(beg, ps.pos));
}
// Parses let syntax.
function parse_let(ps) {
    skip(ps);
    if (starts(ps, "!")) {
        throw new Error("strict lets are outside SupVM's subset");
    }
    if (starts(ps, "&")) {
        ps.pos += 1;
    }
    var nam = parse_name(ps);
    skip(ps);
    if (starts(ps, "&")) {
        throw new Error("explicit DUP lets are outside SupVM's subset");
    }
    consume(ps, "=");
    var val = parse_term(ps);
    skip(ps);
    if (starts(ps, ";")) {
        ps.pos += 1;
    }
    var bod = parse_term(ps);
    return Let(nam, val, bod);
}
// Parses a superposition or eraser.
function parse_sup(ps) {
    skip(ps);
    if (starts(ps, "{}")) {
        ps.pos += 2;
        return Era();
    }
    var lab = parse_name(ps);
    skip(ps);
    var cap = 0;
    if (starts(ps, "[")) {
        cap = parse_sup_captures(ps);
    }
    consume(ps, "{");
    var lft = parse_term(ps);
    skip(ps);
    if (starts(ps, ";") || starts(ps, ",")) {
        ps.pos += 1;
    }
    var rgt = parse_term(ps);
    skip(ps);
    if (starts(ps, ";") || starts(ps, ",")) {
        ps.pos += 1;
    }
    consume(ps, "}");
    return Sup(lab, lft, rgt, cap);
}
// Parses and ignores sup-fork captures.
function parse_sup_captures(ps) {
    consume(ps, "[");
    var cap = 0;
    while (true) {
        skip(ps);
        if (starts(ps, "]")) {
            ps.pos += 1;
            return cap;
        }
        if (starts(ps, "&")) {
            ps.pos += 1;
        }
        parse_name(ps);
        cap += 1;
        skip(ps);
        if (starts(ps, ",")) {
            ps.pos += 1;
        }
    }
}
// Parses a list literal.
function parse_list(ps) {
    consume(ps, "[");
    var els = [];
    skip(ps);
    if (starts(ps, "]")) {
        ps.pos += 1;
        return Ctr("Nil", []);
    }
    while (true) {
        els.push(parse_term(ps));
        skip(ps);
        if (starts(ps, ",")) {
            ps.pos += 1;
            skip(ps);
        }
        if (starts(ps, "]")) {
            ps.pos += 1;
            break;
        }
    }
    var out = Ctr("Nil", []);
    for (var idx = els.length - 1; idx >= 0; idx--) {
        out = Ctr("Cons", [els[idx], out]);
    }
    return out;
}
// Parses a number or nat literal.
function parse_num_or_nat(ps) {
    var num = parse_digits(ps);
    if (!starts(ps, "n")) {
        return Num(num);
    }
    if (num < 0) {
        throw new Error("negative nat literal at byte " + ps.pos);
    }
    ps.pos += 1;
    var end = Ctr("Zero", []);
    if (starts(ps, "+")) {
        ps.pos += 1;
        end = parse_term(ps);
    }
    for (var idx = 0; idx < num; idx++) {
        end = Ctr("Succ", [end]);
    }
    return end;
}
// Evaluation
// ==========
// Creates a runtime.
function runtime_new(book) {
    return { book, itrs: 0, fresh: 0 };
}
// Increments the interaction counter.
function tick(rt) {
    rt.itrs += 1;
}
// Forces a suspension to weak-head normal form.
function force(rt, chs, sus) {
    switch (sus.$) {
        case "Term": {
            return eval_term(rt, chs, sus.term, sus.env);
        }
        case "Val": {
            return eval_val(rt, chs, sus.val);
        }
        case "Add": {
            return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Add");
        }
        case "Sub": {
            return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Sub");
        }
        case "Mul": {
            return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Mul");
        }
        case "Div": {
            return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Div");
        }
        case "Mod": {
            return eval_bin_num(rt, chs, sus.lft, sus.rgt, "Mod");
        }
        case "App": {
            var fun = force(rt, chs, sus.fun);
            return apply_val(rt, chs, fun, sus.arg);
        }
        case "Eql": {
            return eval_eql(rt, chs, sus.lft, sus.rgt);
        }
        case "Leq": {
            return eval_leq(rt, chs, sus.lft, sus.rgt);
        }
        case "And": {
            return eval_and(rt, chs, sus.lft, sus.rgt);
        }
        case "Many": {
            return eval_many(rt, chs, sus.lft, sus.rgt, sus.idx);
        }
    }
}
// Resolves a value against already-made choices.
function eval_val(rt, chs, val) {
    if (val.$ === "Sup") {
        var pic = chs.get(val.lab);
        if (pic === 0) {
            return force(rt, chs, val.lft);
        }
        if (pic === 1) {
            return force(rt, chs, val.rgt);
        }
    }
    return val;
}
// Evaluates a term to weak-head normal form.
function eval_term(rt, chs, trm, env) {
    switch (trm.$) {
        case "Var": {
            var got = env.get(trm.nam);
            if (got === undefined) {
                return { $: "Var", nam: trm.nam };
            }
            return force(rt, chs, got);
        }
        case "Ref": {
            var def = rt.book.get(trm.nam);
            if (def === undefined) {
                return { $: "Var", nam: "@" + trm.nam };
            }
            return eval_term(rt, chs, def, new Map());
        }
        case "Lam": {
            return { $: "Lam", nam: trm.nam, bod: trm.bod, env };
        }
        case "Mat": {
            return { $: "Mat", css: trm.css, env };
        }
        case "App": {
            var fun = force(rt, chs, Sterm(trm.fun, env));
            return apply_val(rt, chs, fun, Sterm(trm.arg, env));
        }
        case "Add": {
            return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Add");
        }
        case "Sub": {
            return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Sub");
        }
        case "Mul": {
            return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Mul");
        }
        case "Div": {
            return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Div");
        }
        case "Mod": {
            return eval_bin_num(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env), "Mod");
        }
        case "Let": {
            tick(rt);
            var nenv = new Map(env);
            nenv.set(trm.nam, Sterm(trm.val, env));
            return force(rt, chs, Sterm(trm.bod, nenv));
        }
        case "Sup": {
            rt.itrs += trm.cap;
            var pic = chs.get(trm.lab);
            if (pic === 0) {
                return force(rt, chs, Sterm(trm.lft, env));
            }
            if (pic === 1) {
                return force(rt, chs, Sterm(trm.rgt, env));
            }
            return { $: "Sup", lab: trm.lab, lft: Sterm(trm.lft, env), rgt: Sterm(trm.rgt, env) };
        }
        case "Era": {
            return { $: "Era" };
        }
        case "Num": {
            return { $: "Num", val: trm.val };
        }
        case "Ctr": {
            var fds = trm.fds.map(fld => Sterm(fld, env));
            return { $: "Ctr", nam: trm.nam, fds };
        }
        case "Eql": {
            return eval_eql(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env));
        }
        case "Leq": {
            return eval_leq(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env));
        }
        case "And": {
            return eval_and(rt, chs, Sterm(trm.lft, env), Sterm(trm.rgt, env));
        }
    }
}
// Applies a value to an argument suspension.
function apply_val(rt, chs, fun, arg) {
    fun = eval_val(rt, chs, fun);
    switch (fun.$) {
        case "Era": {
            return { $: "Era" };
        }
        case "Lam": {
            tick(rt);
            var nenv = new Map(fun.env);
            nenv.set(fun.nam, arg);
            return force(rt, chs, Sterm(fun.bod, nenv));
        }
        case "Mat": {
            return apply_mat(rt, chs, fun, arg);
        }
        case "Sup": {
            tick(rt);
            return { $: "Sup", lab: fun.lab, lft: Sapp(fun.lft, arg), rgt: Sapp(fun.rgt, arg) };
        }
        default: {
            return { $: "App", fun, arg };
        }
    }
}
// Applies a matcher to an argument.
function apply_mat(rt, chs, mat, arg) {
    var val = force(rt, chs, arg);
    val = eval_val(rt, chs, val);
    switch (val.$) {
        case "Era": {
            return { $: "Era" };
        }
        case "Sup": {
            tick(rt);
            var mvl = mat;
            return { $: "Sup", lab: val.lab, lft: Sapp(Sval(mvl), val.lft), rgt: Sapp(Sval(mvl), val.rgt) };
        }
        case "Ctr": {
            return apply_mat_ctr(rt, chs, mat, val);
        }
        case "Num": {
            return apply_mat_num(rt, chs, mat, val);
        }
        default: {
            return { $: "App", fun: mat, arg: Sval(val) };
        }
    }
}
// Applies a matcher to a constructor.
function apply_mat_ctr(rt, chs, mat, ctr) {
    for (var idx = 0; idx < mat.css.length; idx++) {
        var cse = mat.css[idx];
        if (cse.$ !== "Ctr") {
            tick(rt);
            continue;
        }
        if (cse.nam !== ctr.nam) {
            tick(rt);
            continue;
        }
        tick(rt);
        var out = Sterm(cse.bod, mat.env);
        for (var f = 0; f < ctr.fds.length; f++) {
            out = Sapp(out, ctr.fds[f]);
        }
        return force(rt, chs, out);
    }
    return { $: "App", fun: mat, arg: Sval(ctr) };
}
// Applies a matcher to a number.
function apply_mat_num(rt, chs, mat, num) {
    for (var idx = 0; idx < mat.css.length; idx++) {
        var cse = mat.css[idx];
        if (cse.$ !== "Num") {
            tick(rt);
            continue;
        }
        if (cse.val !== num.val) {
            tick(rt);
            continue;
        }
        tick(rt);
        return force(rt, chs, Sterm(cse.bod, mat.env));
    }
    return { $: "App", fun: mat, arg: Sval(num) };
}
// Evaluates a structural equality.
function eval_eql(rt, chs, lft, rgt) {
    var lfv = force(rt, chs, lft);
    lfv = eval_val(rt, chs, lfv);
    if (lfv.$ === "Era") {
        return { $: "Era" };
    }
    if (lfv.$ === "Sup") {
        tick(rt);
        return { $: "Sup", lab: lfv.lab, lft: Seql(lfv.lft, rgt), rgt: Seql(lfv.rgt, rgt) };
    }
    var rgv = force(rt, chs, rgt);
    rgv = eval_val(rt, chs, rgv);
    if (rgv.$ === "Era") {
        return { $: "Era" };
    }
    if (rgv.$ === "Sup") {
        tick(rt);
        return { $: "Sup", lab: rgv.lab, lft: Seql(lft, rgv.lft), rgt: Seql(lft, rgv.rgt) };
    }
    return eval_eql_val(rt, chs, lfv, rgv);
}
// Compares two weak-head values structurally.
function eval_eql_val(rt, chs, lft, rgt) {
    if (lft.$ === "Num" && rgt.$ === "Num") {
        tick(rt);
        return { $: "Num", val: lft.val === rgt.val ? 1 : 0 };
    }
    if (lft.$ === "Ctr" && rgt.$ === "Ctr") {
        tick(rt);
        if (lft.nam !== rgt.nam || lft.fds.length !== rgt.fds.length) {
            return { $: "Num", val: 0 };
        }
        if (lft.fds.length === 0) {
            return { $: "Num", val: 1 };
        }
        return force(rt, chs, Smany(lft.fds, rgt.fds, 0));
    }
    if (lft.$ === "Var" && rgt.$ === "Var") {
        tick(rt);
        return { $: "Num", val: lft.nam === rgt.nam ? 1 : 0 };
    }
    tick(rt);
    return { $: "Num", val: 0 };
}
// Creates a numeric binary suspension.
function Sbin(op, lft, rgt) {
    switch (op) {
        case "Add": {
            return Sadd(lft, rgt);
        }
        case "Sub": {
            return Ssub(lft, rgt);
        }
        case "Mul": {
            return Smul(lft, rgt);
        }
        case "Div": {
            return Sdiv(lft, rgt);
        }
        case "Mod": {
            return Smod(lft, rgt);
        }
    }
}
// Applies a numeric binary operation.
function apply_bin_op(op, lft, rgt) {
    switch (op) {
        case "Add": {
            return lft + rgt;
        }
        case "Sub": {
            return lft - rgt;
        }
        case "Mul": {
            return lft * rgt;
        }
        case "Div": {
            if (rgt === 0) {
                return 0;
            }
            return Math.trunc(lft / rgt);
        }
        case "Mod": {
            if (rgt === 0) {
                return 0;
            }
            var out = lft % rgt;
            return out < 0 ? out + Math.abs(rgt) : out;
        }
    }
}
// Evaluates a numeric binary operation.
function eval_bin_num(rt, chs, lft, rgt, op) {
    var lfv = force(rt, chs, lft);
    lfv = eval_val(rt, chs, lfv);
    if (lfv.$ === "Era") {
        return { $: "Era" };
    }
    if (lfv.$ === "Sup") {
        tick(rt);
        return { $: "Sup", lab: lfv.lab, lft: Sbin(op, lfv.lft, rgt), rgt: Sbin(op, lfv.rgt, rgt) };
    }
    var rgv = force(rt, chs, rgt);
    rgv = eval_val(rt, chs, rgv);
    if (rgv.$ === "Era") {
        return { $: "Era" };
    }
    if (rgv.$ === "Sup") {
        tick(rt);
        return { $: "Sup", lab: rgv.lab, lft: Sbin(op, lft, rgv.lft), rgt: Sbin(op, lft, rgv.rgt) };
    }
    if (lfv.$ === "Num" && rgv.$ === "Num") {
        tick(rt);
        return { $: "Num", val: apply_bin_op(op, lfv.val, rgv.val) };
    }
    tick(rt);
    return { $: "Num", val: 0 };
}
// Evaluates a numeric less-than-or-equal comparison.
function eval_leq(rt, chs, lft, rgt) {
    var lfv = force(rt, chs, lft);
    lfv = eval_val(rt, chs, lfv);
    if (lfv.$ === "Era") {
        return { $: "Era" };
    }
    if (lfv.$ === "Sup") {
        tick(rt);
        return { $: "Sup", lab: lfv.lab, lft: Sleq(lfv.lft, rgt), rgt: Sleq(lfv.rgt, rgt) };
    }
    var rgv = force(rt, chs, rgt);
    rgv = eval_val(rt, chs, rgv);
    if (rgv.$ === "Era") {
        return { $: "Era" };
    }
    if (rgv.$ === "Sup") {
        tick(rt);
        return { $: "Sup", lab: rgv.lab, lft: Sleq(lft, rgv.lft), rgt: Sleq(lft, rgv.rgt) };
    }
    if (lfv.$ === "Num" && rgv.$ === "Num") {
        tick(rt);
        return { $: "Num", val: lfv.val <= rgv.val ? 1 : 0 };
    }
    tick(rt);
    return { $: "Num", val: 0 };
}
// Evaluates a sequence of field equalities.
function eval_many(rt, chs, lft, rgt, idx) {
    var pos = idx;
    while (pos < lft.length) {
        var cur = force(rt, chs, Seql(lft[pos], rgt[pos]));
        cur = eval_val(rt, chs, cur);
        if (cur.$ === "Era") {
            return cur;
        }
        if (cur.$ === "Sup") {
            var nxt = Smany(lft, rgt, pos + 1);
            return { $: "Sup", lab: cur.lab, lft: Sand(cur.lft, nxt), rgt: Sand(cur.rgt, nxt) };
        }
        if (cur.$ !== "Num") {
            tick(rt);
            return { $: "Num", val: 0 };
        }
        if (pos + 1 < lft.length) {
            tick(rt);
        }
        if (cur.val === 0) {
            return cur;
        }
        pos += 1;
    }
    return { $: "Num", val: 1 };
}
// Evaluates boolean and.
function eval_and(rt, chs, lft, rgt) {
    var val = force(rt, chs, lft);
    val = eval_val(rt, chs, val);
    switch (val.$) {
        case "Era": {
            return val;
        }
        case "Sup": {
            tick(rt);
            return { $: "Sup", lab: val.lab, lft: Sand(val.lft, rgt), rgt: Sand(val.rgt, rgt) };
        }
        case "Num": {
            tick(rt);
            if (val.val === 0) {
                return { $: "Num", val: 0 };
            }
            return force(rt, chs, rgt);
        }
        default: {
            tick(rt);
            return { $: "Num", val: 0 };
        }
    }
}
// CNF / collapse
// ==============
// Maps a CNF result.
function cnf_map(cnf, fnc) {
    switch (cnf.$) {
        case "Leaf": {
            return { $: "Leaf", val: fnc(cnf.val) };
        }
        case "Era": {
            return cnf;
        }
        case "Fork": {
            var lab = cnf.lab;
            var lft = cnf.lft;
            var rgt = cnf.rgt;
            return {
                $: "Fork",
                lab,
                lft: (rt, chs) => cnf_map(lft(rt, chs), fnc),
                rgt: (rt, chs) => cnf_map(rgt(rt, chs), fnc),
            };
        }
    }
}
// Binds a CNF result.
function cnf_bind(cnf, fnc) {
    switch (cnf.$) {
        case "Leaf": {
            return fnc(cnf.val);
        }
        case "Era": {
            return cnf;
        }
        case "Fork": {
            var lab = cnf.lab;
            var lft = cnf.lft;
            var rgt = cnf.rgt;
            return {
                $: "Fork",
                lab,
                lft: (rt, chs) => cnf_bind(lft(rt, chs), fnc),
                rgt: (rt, chs) => cnf_bind(rgt(rt, chs), fnc),
            };
        }
    }
}
// Converts a suspension to collapsed normal form, lifting one SUP.
function cnf_susp(rt, chs, sus) {
    var val = force(rt, chs, sus);
    return cnf_val(rt, chs, val);
}
// Converts a value to collapsed normal form, lifting one SUP.
function cnf_val(rt, chs, val) {
    val = eval_val(rt, chs, val);
    switch (val.$) {
        case "Era": {
            return { $: "Era" };
        }
        case "Num": {
            return { $: "Leaf", val: NNum(val.val) };
        }
        case "Var": {
            return { $: "Leaf", val: NVar(val.nam) };
        }
        case "Sup": {
            var pic = chs.get(val.lab);
            if (pic === 0) {
                return cnf_susp(rt, chs, val.lft);
            }
            if (pic === 1) {
                return cnf_susp(rt, chs, val.rgt);
            }
            return {
                $: "Fork",
                lab: val.lab,
                lft: (nrt, nch) => cnf_susp(nrt, nch, val.lft),
                rgt: (nrt, nch) => cnf_susp(nrt, nch, val.rgt),
            };
        }
        case "Lam": {
            var nam = fresh_var(rt);
            var nenv = new Map(val.env);
            nenv.set(val.nam, Sval({ $: "Var", nam }));
            var bod = cnf_susp(rt, chs, Sterm(val.bod, nenv));
            return cnf_map(bod, out => NLam(nam, out));
        }
        case "Mat": {
            return cnf_cases(rt, chs, val.css, val.env, 0, []);
        }
        case "Ctr": {
            return cnf_fields(rt, chs, val.fds, 0, [], fds => NCtr(val.nam, fds));
        }
        case "App": {
            var fun = cnf_val(rt, chs, val.fun);
            return cnf_bind(fun, nfn => {
                var arg = cnf_susp(rt, chs, val.arg);
                return cnf_map(arg, nar => NApp(nfn, nar));
            });
        }
    }
}
// Normalizes match cases.
function cnf_cases(rt, chs, css, env, idx, acc) {
    if (idx >= css.length) {
        return { $: "Leaf", val: NMat(acc) };
    }
    var cse = css[idx];
    var bod = cnf_susp(rt, chs, Sterm(cse.bod, env));
    return cnf_bind(bod, nbod => {
        var out = acc.slice();
        if (cse.$ === "Ctr") {
            out.push({ $: "Ctr", nam: cse.nam, bod: nbod });
        }
        else {
            out.push({ $: "Num", val: cse.val, bod: nbod });
        }
        return cnf_cases(rt, chs, css, env, idx + 1, out);
    });
}
// Normalizes a list of child suspensions.
function cnf_fields(rt, chs, fds, idx, acc, fin) {
    if (idx >= fds.length) {
        return { $: "Leaf", val: fin(acc) };
    }
    var fld = cnf_susp(rt, chs, fds[idx]);
    return cnf_bind(fld, nfd => {
        var out = acc.slice();
        out.push(nfd);
        return cnf_fields(rt, chs, fds, idx + 1, out, fin);
    });
}
// Creates a fresh internal variable name.
function fresh_var(rt) {
    var out = "$" + rt.fresh;
    rt.fresh += 1;
    return out;
}
// Copies a choice map and adds one choice.
function choice_ext(chs, lab, pic) {
    var out = new Map(chs);
    out.set(lab, pic);
    return out;
}
// Runs collapse and returns the first leaf.
function collapse(rt, root, lim) {
    var que = [{ job: (nrt, nch) => cnf_susp(nrt, nch, root), chs: new Map() }];
    var pos = 0;
    var got = 0;
    while (pos < que.length) {
        var itm = que[pos++];
        var cnf = itm.job(rt, itm.chs);
        switch (cnf.$) {
            case "Era": {
                break;
            }
            case "Leaf": {
                got += 1;
                if (got >= lim) {
                    return cnf.val;
                }
                break;
            }
            case "Fork": {
                que.push({ job: cnf.lft, chs: choice_ext(itm.chs, cnf.lab, 0) });
                que.push({ job: cnf.rgt, chs: choice_ext(itm.chs, cnf.lab, 1) });
                break;
            }
        }
    }
    return null;
}
// Pretty printer
// ==============
// Prints a base-26 alpha name.
function alpha_name(num, base) {
    if (num <= 0) {
        return "_";
    }
    var chr = base.charCodeAt(0);
    var out = "";
    var cur = num;
    while (cur > 0) {
        cur -= 1;
        out = String.fromCharCode(chr + (cur % 26)) + out;
        cur = Math.floor(cur / 26);
    }
    return out;
}
// Prints a normal term.
function show_norm(trm) {
    return show_go(trm, new Map(), 0);
}
// Prints a normal term recursively.
function show_go(trm, ctx, dep) {
    switch (trm.$) {
        case "Var": {
            return ctx.get(trm.nam) || trm.nam;
        }
        case "Num": {
            return String(trm.val);
        }
        case "Lam": {
            var nam = alpha_name(dep + 1, "a");
            var nctx = new Map(ctx);
            nctx.set(trm.nam, nam);
            return "λ" + nam + "." + show_go(trm.bod, nctx, dep + 1);
        }
        case "Mat": {
            var buf = "λ{";
            for (var idx = 0; idx < trm.css.length; idx++) {
                if (idx > 0) {
                    buf += ";";
                }
                var cse = trm.css[idx];
                buf += show_case_key(cse) + ":" + show_go(cse.bod, ctx, dep);
            }
            return buf + "}";
        }
        case "App": {
            return show_app(trm, ctx, dep);
        }
        case "Ctr": {
            return show_ctr(trm, ctx, dep);
        }
    }
}
// Prints an application spine.
function show_app(trm, ctx, dep) {
    var args = [];
    var cur = trm;
    while (cur.$ === "App") {
        args.push(cur.arg);
        cur = cur.fun;
    }
    var out = show_go(cur, ctx, dep);
    if (cur.$ === "Lam") {
        out = "(" + out + ")";
    }
    out += "(";
    for (var idx = args.length - 1; idx >= 0; idx--) {
        if (idx !== args.length - 1) {
            out += ",";
        }
        out += show_go(args[idx], ctx, dep);
    }
    return out + ")";
}
// Prints a match key.
function show_case_key(cse) {
    if (cse.$ === "Num") {
        return String(cse.val);
    }
    switch (cse.nam) {
        case "Zero": {
            return "0n";
        }
        case "Succ": {
            return "1n+";
        }
        case "Nil": {
            return "[]";
        }
        case "Cons": {
            return "<>";
        }
        default: {
            return "#" + cse.nam;
        }
    }
}
// Prints a constructor.
function show_ctr(trm, ctx, dep) {
    var nat = nat_view(trm);
    if (nat !== null) {
        if (nat.rest === null) {
            return String(nat.num) + "n";
        }
        return String(nat.num) + "n+" + show_go(nat.rest, ctx, dep);
    }
    if (is_list_end(trm)) {
        return "[]";
    }
    if (trm.nam === "Cons") {
        var arr = list_view(trm);
        if (arr.end === null) {
            var out = "[";
            for (var idx = 0; idx < arr.items.length; idx++) {
                if (idx > 0) {
                    out += ",";
                }
                out += show_go(arr.items[idx], ctx, dep);
            }
            return out + "]";
        }
        return show_go(trm.fds[0], ctx, dep) + "<>" + show_go(trm.fds[1], ctx, dep);
    }
    var buf = "#" + trm.nam + "{";
    for (var idx = 0; idx < trm.fds.length; idx++) {
        if (idx > 0) {
            buf += ",";
        }
        buf += show_go(trm.fds[idx], ctx, dep);
    }
    return buf + "}";
}
// Tests whether a constructor is nil.
function is_list_end(trm) {
    return trm.$ === "Ctr" && trm.nam === "Nil" && trm.fds.length === 0;
}
// Views a proper or improper list.
function list_view(trm) {
    var cur = trm;
    var out = [];
    while (cur.$ === "Ctr" && cur.nam === "Cons" && cur.fds.length === 2) {
        out.push(cur.fds[0]);
        cur = cur.fds[1];
    }
    if (is_list_end(cur)) {
        return { items: out, end: null };
    }
    return { items: out, end: cur };
}
// Views a natural-number constructor.
function nat_view(trm) {
    var cur = trm;
    var num = 0;
    while (cur.$ === "Ctr" && cur.nam === "Succ" && cur.fds.length === 1) {
        num += 1;
        cur = cur.fds[0];
    }
    if (cur.$ === "Ctr" && cur.nam === "Zero" && cur.fds.length === 0) {
        return { num, rest: null };
    }
    if (num > 0) {
        return { num, rest: cur };
    }
    return null;
}
// Browser API
// ===========
export function runBabySupVm(source, options = {}) {
    const start = Date.now();
    const collapseRequested = Number(options.collapse ?? 1);
    let limit = collapseRequested === 0 ? 1 : collapseRequested;
    if (limit < 0 || !Number.isFinite(limit)) {
        limit = 1;
    }
    const book = parse_program(String(source || ""));
    const main = book.get("main");
    if (main === undefined) {
        throw new Error("missing @main definition");
    }
    const rt = runtime_new(book);
    const got = collapse(rt, Sterm(Ref("main"), new Map()), limit);
    const valueText = got === null ? null : show_norm(got);
    const stdout = valueText === null ? "" : valueText + " #" + rt.itrs + "\n- Itrs: " + rt.itrs + " interactions\n";
    return {
        ok: true,
        code: 0,
        signal: null,
        timedOut: false,
        stdout,
        stderr: "",
        valueText,
        interactions: rt.itrs,
        elapsedMs: Date.now() - start,
        collapseRequested,
        error: null,
        runtime: "browser-worker",
    };
}
export const babySupVmRuntime = Object.freeze({
    run: runBabySupVm,
});
