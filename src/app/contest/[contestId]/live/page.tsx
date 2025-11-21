"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import type { Contest, Question } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import Editor from "@monaco-editor/react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Clock, Code, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/*
 Screenshot for reference (uploaded):
 /mnt/data/Screenshot 2025-11-21 132412.png
*/

/* ---------------------------
   Fallback defaults for compiled langs
   --------------------------- */
const fallbackDefaultCode: Record<string, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int solve(vector<int> input){
    // write your logic here
}`,
  c: `#include <stdio.h>

int solve(int input[], int size){
    // write your logic here
}`,
  java: `import java.util.*;

public class Main {
    public static int solve(List<Integer> input) {
        // write your logic here
    }
}`,
};

/* ---------------------------
   Helper: param sanitization & type mapping & default code generator
   --------------------------- */
function sanitizeParamName(name?: string, idx = 0) {
  if (!name) return `p${idx + 1}`;
  let s = String(name).trim();
  // replace invalid identifier chars with underscore, trim edges
  try {
    s = s.replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "");
  } catch {
    // fallback if Unicode regex unsupported in environment
    s = s.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  }
  if (/^[0-9]/.test(s)) s = "_" + s;
  if (!s) return `p${idx + 1}`;
  return s;
}

function mapTypeToJsDoc(type?: string) {
  if (!type) return "any";
  const t = type.toLowerCase();
  if (t === "int" || t === "long" || t === "number") return "number";
  if (t === "float" || t === "double") return "number";
  if (t === "string") return "string";
  if (t === "bool" || t === "boolean") return "boolean";
  if (t === "array" || t === "list") return "Array";
  return "any";
}

function mapTypeToPythonHint(type?: string) {
  if (!type) return "Any";
  const t = type.toLowerCase();
  if (t === "int" || t === "long" || t === "number") return "int";
  if (t === "float" || t === "double") return "float";
  if (t === "string") return "str";
  if (t === "bool" || t === "boolean") return "bool";
  if (t === "array" || t === "list") return "list";
  return "Any";
}

/**
 * Generate starter code according to language and admin inputs.
 * - JS: JSDoc @param types
 * - Python: type hints + optional Any import
 * - Fallback for compiled langs uses `fallbackDefaultCode`
 */
function generateDefaultCode(language: string, inputsMeta: any[] = []) {
  const params =
    inputsMeta && inputsMeta.length > 0
      ? inputsMeta.map((m: any, i: number) => sanitizeParamName(m?.name, i))
      : ["input"];

  if (language === "javascript") {
    const jsdocLines = ["/**"];
    for (let i = 0; i < params.length; i++) {
      const t = mapTypeToJsDoc(inputsMeta?.[i]?.type);
      jsdocLines.push(` * @param {${t}} ${params[i]}`);
    }
    jsdocLines.push(" * @returns {any}");
    jsdocLines.push(" */");
    const jsdoc = jsdocLines.join("\n");
    return `${jsdoc}
function solve(${params.join(", ")}) {
  // write your logic here
  // Example: return ${params[0]}${params[1] ? " + " + params[1] : ""};
}`;
  }

  if (language === "python") {
    const needAny = inputsMeta?.some((m: any) => !m?.type);
    const imports = needAny ? "from typing import Any\n\n" : "";
    const paramHints = params
      .map((p, i) => `${p}: ${mapTypeToPythonHint(inputsMeta?.[i]?.type)}`)
      .join(", ");
    return `${imports}def solve(${paramHints}):
    \"\"\"Write your solution here.\"\"\"
    # write your logic here `;
  }

  // compiled languages fallback
  if (language === "cpp") return fallbackDefaultCode.cpp;
  if (language === "c") return fallbackDefaultCode.c;
  if (language === "java") return fallbackDefaultCode.java;

  return `function solve(${params.join(", ")}) {
  // write your logic here
}`;
}

/* ---------------------------
   Helpers: parsing sample input tokens and converting to literals
   --------------------------- */
function parseTokenToValue(token: string, type?: string) {
  const t = (type || "").toLowerCase();
  if (t === "int" || t === "long" || t === "number") {
    if (/^-?\d+$/.test(token)) return parseInt(token, 10);
    const n = Number(token);
    return Number.isFinite(n) ? Math.trunc(n) : token;
  }
  if (t === "float" || t === "double") {
    const n = Number(token);
    return Number.isFinite(n) ? n : token;
  }
  if (t === "bool" || t === "boolean") {
    if (/^(true|1)$/i.test(token)) return true;
    if (/^(false|0)$/i.test(token)) return false;
    return Boolean(token);
  }
  if (t === "string") {
    return token;
  }
  if (t === "array" || t === "list") {
    const trimmed = token.trim();
    if (/^[\[\{].*[\]\}]$/.test(trimmed)) {
      try {
        return JSON.parse(trimmed);
      } catch {}
    }
    return trimmed === "" ? [] : trimmed.split(/\s+/);
  }
  try {
    return JSON.parse(token);
  } catch {
    return token;
  }
}

function toJSLiteral(value: any) {
  return JSON.stringify(value);
}

function toPythonLiteral(value: any) {
  if (value === null) return "None";
  if (Array.isArray(value) || typeof value === "object") {
    // We'll inject using json.loads('<json>') in wrapper when needed.
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `'${escaped}'`;
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function parseSampleInputToArgs(sampleInputStr: string, inputsMeta: any[] = []) {
  const s = (sampleInputStr ?? "").trim();
  if (s === "") {
    // fallback to examples in metadata
    return inputsMeta.map((m) => parseTokenToValue(String(m?.example ?? ""), m?.type));
  }

  if (/^[\[\{].*[\]\}]$/.test(s)) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && inputsMeta.length > 1) {
        return inputsMeta.map((m, i) => {
          const v = parsed[i];
          if (v === undefined) return parseTokenToValue(String(m?.example ?? ""), m?.type);
          return parseTokenToValue(String(v), m?.type);
        });
      } else if (inputsMeta.length === 1) {
        return [parsed];
      } else {
        return [parsed];
      }
    } catch {}
  }

  let tokens = s.split(/\s+/);
  if (tokens.length === 1 && s.includes(",") && !s.includes(" ")) {
    tokens = s.split(",").map((x) => x.trim()).filter(Boolean);
  }

  if (tokens.length > inputsMeta.length && inputsMeta.length > 0) {
    const first = tokens.slice(0, inputsMeta.length - 1);
    const last = tokens.slice(inputsMeta.length - 1).join(" ");
    tokens = first.concat([last]);
  }

  if (inputsMeta && inputsMeta.length > 0) {
    return inputsMeta.map((m, i) => {
      const token = tokens[i] ?? String(m?.example ?? "");
      return parseTokenToValue(String(token), m?.type);
    });
  }

  return tokens.map((t) => {
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  });
}

/* ---------------------------
   Piston call helper and output extraction
   --------------------------- */
async function runCode(language: string, code: string, stdin = "") {
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, code, stdin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Execution failed");
  return data;
}

const extractOutputFromPiston = (result: any) => {
  const run = result?.run ?? result;
  const out = run?.output ?? run?.stdout ?? run?.stderr ?? "";
  return String(out ?? "");
};

/* ---------------------------
   Utility: sample input/output array normalization
   --------------------------- */
function getSamplePairsFromQuestion(q: Question) {
  const inputsArr: string[] = Array.isArray((q as any).sampleInputs)
    ? (q as any).sampleInputs
    : (typeof (q as any).sampleInput === "string" ? [(q as any).sampleInput] : []);
  const outputsArr: string[] = Array.isArray((q as any).sampleOutputs)
    ? (q as any).sampleOutputs
    : (typeof (q as any).sampleOutput === "string" ? [(q as any).sampleOutput] : []);
  while (outputsArr.length < inputsArr.length) outputsArr.push("");
  return { inputsArr, outputsArr };
}

/* ---------------------------
   Wrapper builder: injects named params and calls solve(...)
   --------------------------- */
function buildWrapperForLanguage(
  lang: string,
  userCode: string,
  sampleInputStr: string,
  inputsMeta: any[] = []
) {
  const args = parseSampleInputToArgs(sampleInputStr, inputsMeta);
  const paramNames =
    inputsMeta && inputsMeta.length > 0
      ? inputsMeta.map((m: any, idx: number) => sanitizeParamName(m?.name, idx))
      : args.map((_, idx) => String.fromCharCode(97 + idx)); // a, b, c

  if (lang === "javascript") {
    const declarations = paramNames
      .map((name, i) => `const ${name} = ${toJSLiteral(args[i])};`)
      .join("\n");
    const callArgs = paramNames.join(", ");
    const wrapped = `\n${userCode}\n${declarations}\n(solve(${callArgs});\n`;
    return { code: wrapped, stdin: "" };
  }

  if (lang === "python") {
    const needJson = args.some((a) => typeof a === "object" && a !== null);
    const imports = needJson ? "import json\n" : "";
    const declarations = args
      .map((a, i) => {
        const name = paramNames[i];
        if (typeof a === "object" && a !== null) {
          const jsonStr = JSON.stringify(a).replace(/'/g, "\\'");
          return `${name} = json.loads('${jsonStr}')`;
        }
        return `${name} = ${toPythonLiteral(a)}`;
      })
      .join("\n");
    const callArgs = paramNames.join(", ");
    const wrapped = `\n${imports}${userCode}\n${declarations}\nsolve(${callArgs})\n`;
    return { code: wrapped, stdin: "" };
  }

  // compiled languages: pass stdin directly
  return { code: userCode, stdin: sampleInputStr };
}

/* ---------------------------
   UI Component
   --------------------------- */

type TestResult = {
  index: number;
  input: string;
  expected: string;
  actual: string | null;
  passed: boolean;
  error?: string | null;
};

// small helpers for solved persistence
function solvedStorageKey(contestId: string, userId?: string) {
  return `contest_solved:${contestId}:${userId ?? "anon"}`;
}
function loadSolvedFromLocal(contestId: string, userId?: string) {
  try {
    const raw = localStorage.getItem(solvedStorageKey(contestId, userId));
    if (!raw) return [] as string[];
    return JSON.parse(raw) as string[];
  } catch {
    return [] as string[];
  }
}
function saveSolvedToLocal(contestId: string, userId: string | undefined, solvedArr: string[]) {
  try {
    localStorage.setItem(solvedStorageKey(contestId, userId), JSON.stringify(solvedArr));
  } catch {}
}

export default function LiveContestPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const levelParam = searchParams?.get("level");
  // if levelParam === 'other' handle separately, otherwise try parse to number
  const selectedLevel = levelParam === "other" ? "other" : levelParam ? Number(levelParam) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const contestId = params.contestId as string;

  const [contest, setContest] = useState<Contest | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [output, setOutput] = useState("Run your code to see output here.");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [solved, setSolved] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("output");
  const [isContestOver, setIsContestOver] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  // --- group questions by level (display three divisions) ---
  // We'll arrange questions into Level 1, Level 2, Level 3 buckets. Questions with other levels go into "Other".
  const levelOrder = [1, 2, 3];
  const groupedQuestions = levelOrder.map((lvl) => ({
    level: lvl,
    items: questions.filter((q) => Number(q?.level) === lvl),
  }));
  const otherQuestions = questions.filter((q) => !levelOrder.includes(Number(q?.level)));


  const lockContest = useCallback(async () => {
    if (!user || isContestOver) return;
    setIsContestOver(true);
    await setDoc(
      doc(db, `user_contests/${user.uid}_${contestId}`),
      { status: "ended", endedAt: serverTimestamp() },
      { merge: true }
    );
  }, [contestId, user, isContestOver]);

  const handleTimeUp = useCallback(async () => {
    toast({ title: "Time's Up!", description: "Contest ended." });
    await lockContest();
    router.replace("/dashboard");
  }, [lockContest, router, toast]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        toast({
          title: "Warning",
          description:
            "Switching tabs is discouraged. Leaving the page will end your contest.",
        });
      }
    };
    window.addEventListener("visibilitychange", handleVisibility);

    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      await lockContest();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [lockContest, toast]);

  useEffect(() => {
    if (!contestId) return;
    (async () => {
      setIsLoading(true);
      try {
        const cSnap = await getDoc(doc(db, "contests", contestId));
        if (!cSnap.exists()) return router.replace("/dashboard");
        setContest({ id: cSnap.id, ...(cSnap.data() as any) } as Contest);

        const qSnap = await getDocs(
          query(collection(db, `contests/${contestId}/questions`), orderBy("level"))
        );
        const list = qSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Question[];

        // If a level is specified in the URL (e.g. ?level=1 or ?level=other), filter questions
        let filtered: Question[] = list;
        if (selectedLevel !== null) {
          if (selectedLevel === "other") {
            filtered = list.filter((q) => ![1, 2, 3].includes(Number(q?.level)));
          } else {
            filtered = list.filter((q) => Number(q?.level) === Number(selectedLevel));
          }
        }

        setQuestions(filtered);
        if (filtered.length) setActiveQuestion(filtered[0]);

        // restore solved from local
        const localSolved = loadSolvedFromLocal(contestId, user?.uid);
        if (localSolved && localSolved.length) setSolved(localSolved);
      } catch (err) {
        console.error(err);
        toast({ variant: "destructive", title: "Error", description: "Failed to load contest." });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [contestId, router, toast]);

  // regenerate starter code when language or activeQuestion changes
  useEffect(() => {
    const inputsMeta = Array.isArray(activeQuestion?.inputs) ? activeQuestion!.inputs : [];
    const generated = generateDefaultCode(language, inputsMeta);
    setCode(generated);
  }, [language, activeQuestion]);

  // Run single sample (first)
  const handleRunCode = async () => {
    if (!activeQuestion || isContestOver) return;
    setIsSubmitting(true);
    setActiveTab("output");
    setOutput("Running...");
    try {
      const pistonLang = (language === "javascript" ? "javascript" : language === "python" ? "python3" : language) as string;
      const { inputsArr } = getSamplePairsFromQuestion(activeQuestion);
      const usedInput = inputsArr.length ? inputsArr[0] : (activeQuestion.sampleInput ?? "");
      const inputsMeta = Array.isArray((activeQuestion as any).inputs) ? (activeQuestion as any).inputs : [];
      const { code: wrapped, stdin } = buildWrapperForLanguage(language, code, usedInput || "", inputsMeta);
      const result = await runCode(pistonLang, wrapped, stdin ?? "");
      const text = extractOutputFromPiston(result);
      setOutput(text || "No output.");
    } catch (err: any) {
      setOutput("Error: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit: run all samples and compare (named params)
  const handleSubmitCode = async () => {
    if (!activeQuestion || !user || isContestOver) return;
    setIsSubmitting(true);
    setActiveTab("tests");
    setOutput("Submitting...");
    try {
      const pistonLang = (language === "javascript" ? "javascript" : language === "python" ? "python3" : language) as string;
      const { inputsArr, outputsArr } = getSamplePairsFromQuestion(activeQuestion);
      const sampleInputs = inputsArr.length ? inputsArr : (activeQuestion.sampleInput ? [activeQuestion.sampleInput] : []);
      const sampleOutputs = outputsArr.length ? outputsArr : (activeQuestion.sampleOutput ? [activeQuestion.sampleOutput] : []);
      const inputsMeta = Array.isArray((activeQuestion as any).inputs) ? (activeQuestion as any).inputs : [];

      const results: TestResult[] = [];

      for (let i = 0; i < sampleInputs.length; i++) {
        const sin = sampleInputs[i] ?? "";
        const expected = String(sampleOutputs[i] ?? "");
        try {
          const { code: wrapped, stdin } = buildWrapperForLanguage(language, code, sin, inputsMeta);
          const res = await runCode(pistonLang, wrapped, stdin ?? "");
          const rawOut = extractOutputFromPiston(res);
          const actualTrim = rawOut.trim();
          const expectedTrim = expected.trim();
          const passed = actualTrim === expectedTrim;
          results.push({
            index: i,
            input: sin,
            expected,
            actual: actualTrim,
            passed,
            error: null,
          });
        } catch (runErr: any) {
          results.push({
            index: i,
            input: sin,
            expected,
            actual: null,
            passed: false,
            error: runErr?.message ?? String(runErr),
          });
        }
      }

      setTestResults(results);
      const allPassed = results.length > 0 && results.every((r) => r.passed);

      await addDoc(collection(db, "submissions"), {
        contestId,
        questionId: activeQuestion.id,
        userId: user.uid,
        code,
        language,
        status: allPassed ? "correct" : "incorrect",
        testSummary: {
          passedCount: results.filter((r) => r.passed).length,
          total: results.length,
        },
        submittedAt: serverTimestamp(),
      });

      if (allPassed) {
        toast({ title: "✅ Correct!", description: "All test cases passed!" });
        const newSolved = [...new Set([...solved, activeQuestion.id])];
        setSolved(newSolved);
        // persist solved locally
        saveSolvedToLocal(contestId, user?.uid, newSolved);
        if (questions.length > 0 && newSolved.length === questions.length) {
          toast({ title: "Contest Completed!", description: "All questions submitted." });
          await lockContest();
          router.replace("/dashboard");
        }
      } else {
        toast({ variant: "destructive", title: "❌ Incorrect", description: "Some test cases failed. Check test results." });
      }

      const firstActual = results[0]?.actual ?? results[0]?.error ?? "No output";
      setOutput(`\n${firstActual}`);
    } catch (err: any) {
      setOutput("Error: " + err.message);
      toast({ variant: "destructive", title: "Execution Error", description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="flex h-16 items-center justify-between border-b px-4">
        <h1 className="text-xl font-bold">{contest?.name}</h1>
        {contest && <ContestTimer duration={contest.duration} contestId={contestId} userId={user?.uid} onTimeUp={handleTimeUp} />}
      </header>

      <PanelGroup direction="horizontal" className="flex-grow">
        {/* Questions Panel */}
        <Panel defaultSize={25} minSize={20}>
          <div className="flex flex-col h-full">
            <h2 className="p-4 text-lg font-semibold border-b">Questions</h2>
            <ScrollArea className="flex-grow p-2">
              {/* Render three level buckets */}
              {groupedQuestions.map((group) => (
                <div key={group.level} className="mb-4">
                  <div className="px-2 py-1 bg-muted/50 rounded-t font-medium">Level {group.level}</div>
                  <div className="space-y-1">
                    {group.items.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No questions for level {group.level}.</div>
                    ) : (
                      group.items.map((q) => (
                        <Button
                          key={q.id}
                          variant={activeQuestion?.id === q.id ? "secondary" : "ghost"}
                          className="w-full justify-between rounded-none p-3 h-auto text-left"
                          onClick={() => {
                            if (!isContestOver) {
                              setActiveQuestion(q);
                              const gen = generateDefaultCode(language, (q as any).inputs || []);
                              setCode(gen);
                              setOutput("");
                              setTestResults(null);
                            }
                          }}
                          disabled={isSubmitting || isContestOver}
                        >
                          <span className="truncate">{q.title}</span>
                          {solved.includes(q.id) && <CheckCircle className="h-5 w-5 text-green-500" />}
                        </Button>
                      ))
                    )}
                  </div>
                </div>
              ))}

              {/* Other questions (levels outside 1-3) */}
              {otherQuestions.length > 0 && (
                <div className="mb-4">
                  <div className="px-2 py-1 bg-muted/50 rounded-t font-medium">Other Levels</div>
                  <div className="space-y-1">
                    {otherQuestions.map((q) => (
                      <Button
                        key={q.id}
                        variant={activeQuestion?.id === q.id ? "secondary" : "ghost"}
                        className="w-full justify-between rounded-none p-3 h-auto text-left"
                        onClick={() => {
                          if (!isContestOver) {
                            setActiveQuestion(q);
                            const gen = generateDefaultCode(language, (q as any).inputs || []);
                            setCode(gen);
                            setOutput("");
                            setTestResults(null);
                          }
                        }}
                        disabled={isSubmitting || isContestOver}
                      >
                        <span className="truncate">{q.title} <span className="text-xs text-muted-foreground">(level: {q.level})</span></span>
                        {solved.includes(q.id) && <CheckCircle className="h-5 w-5 text-green-500" />}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* If no questions at all */}
              {questions.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No questions available for this contest.</div>
              )}
            </ScrollArea>
          </div>
        </Panel>

        <PanelResizeHandle className="flex h-full w-2 cursor-col-resize bg-muted" />

        {/* Code Panel */}
        <Panel defaultSize={75} minSize={30}>
          {activeQuestion && (
            <PanelGroup direction="vertical" className="h-full">
              {/* Question Details */}
              <Panel defaultSize={50}>
                <ScrollArea className="h-full p-4">
                  <h2 className="text-2xl font-bold mb-4">{activeQuestion.title}</h2>
                  <p className="text-muted-foreground whitespace-pre-wrap">{activeQuestion.description}</p>

                  <h3 className="font-semibold mt-6 mb-2">Sample Inputs</h3>
                  {Array.isArray((activeQuestion as any).sampleInputs) ? (
                    (activeQuestion as any).sampleInputs.map((si: string, idx: number) => (
                      <pre key={idx} className="bg-muted p-3 rounded text-sm font-mono mb-2">{si}</pre>
                    ))
                  ) : (
                    <pre className="bg-muted p-3 rounded text-sm font-mono">{activeQuestion.sampleInput}</pre>
                  )}

                  <h3 className="font-semibold mt-4 mb-2">Sample Outputs</h3>
                  {Array.isArray((activeQuestion as any).sampleOutputs) ? (
                    (activeQuestion as any).sampleOutputs.map((so: string, idx: number) => (
                      <pre key={idx} className="bg-muted p-3 rounded text-sm font-mono mb-2">{so}</pre>
                    ))
                  ) : (
                    <pre className="bg-muted p-3 rounded text-sm font-mono">{activeQuestion.sampleOutput}</pre>
                  )}

                  <h3 className="font-semibold mt-4 mb-2">Parameters (from admin)</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(Array.isArray((activeQuestion as any).inputs) ? (activeQuestion as any).inputs : []).map((inp: any, i: number) => (
                      <div key={i} className="bg-muted p-2 rounded text-sm">
                        <div className="font-medium">{inp.name ?? `param${i+1}`}</div>
                        <div className="text-xs text-muted-foreground">{inp.type ?? "string"}</div>
                        <div className="text-xs font-mono mt-1">{inp.example ?? ""}</div>
                      </div>
                    ))}
                    {(!Array.isArray((activeQuestion as any).inputs) || (activeQuestion as any).inputs.length === 0) && (
                      <div className="text-sm text-muted-foreground">No parameter metadata provided by admin.</div>
                    )}
                  </div>
                </ScrollArea>
              </Panel>

              <PanelResizeHandle className="flex h-2 items-center justify-center bg-muted hover:bg-muted-foreground/20">
                <div className="h-1 w-10 rounded-full bg-border" />
              </PanelResizeHandle>

              {/* Editor + Output */}
              <Panel defaultSize={50}>
                <div className="flex flex-col h-full">
                  <div className="p-2 border-b flex items-center justify-between">
                    <div className="flex items-center gap-3 font-semibold">
                      <Code className="h-5 w-5" /> Code Editor
                      <Select
                        value={language}
                        onValueChange={(val) => {
                          setLanguage(val);
                          const gen = generateDefaultCode(val, Array.isArray(activeQuestion?.inputs) ? activeQuestion!.inputs : []);
                          setCode(gen);
                        }}
                      >
                        <SelectTrigger className="w-[150px] h-8 text-xs">
                          <SelectValue placeholder="Language" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="javascript">JavaScript</SelectItem>
                          <SelectItem value="python">Python</SelectItem>
                          <SelectItem value="java">Java</SelectItem>
                          <SelectItem value="cpp">C++</SelectItem>
                          <SelectItem value="c">C</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRunCode}
                        disabled={isSubmitting || isContestOver}
                      >
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Run"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSubmitCode}
                        disabled={isSubmitting || isContestOver}
                      >
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Submit"}
                      </Button>
                    </div>
                  </div>

                  <PanelGroup direction="vertical" className="flex-grow">
                    <Panel defaultSize={60}>
                      <Editor
                        height="100%"
                        language={language}
                        value={code}
                        onChange={(v) => !isContestOver && setCode(v || "")}
                        theme="vs-dark"
                        options={{
                          fontSize: 14,
                          minimap: { enabled: false },
                          automaticLayout: true,
                          readOnly: isContestOver,
                        }}
                      />
                    </Panel>
                    <PanelResizeHandle className="flex h-2 items-center justify-center bg-muted hover:bg-muted-foreground/20">
                      <div className="h-1 w-10 rounded-full bg-border" />
                    </PanelResizeHandle>
                    <Panel defaultSize={40}>
                      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
                        <TabsList className="justify-start rounded-none border-b bg-card px-4">
                          <TabsTrigger value="output">Output</TabsTrigger>
                          <TabsTrigger value="tests">Test Results</TabsTrigger>
                        </TabsList>
                        <TabsContent value="output" className="flex-grow overflow-y-auto bg-black text-white p-4">
                          <pre className="font-mono whitespace-pre-wrap">{output}</pre>
                        </TabsContent>
                        <TabsContent value="tests" className="flex-grow p-4">
                          {!testResults ? (
                            <p className="text-muted-foreground">Test results will appear here after you click Submit.</p>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex items-center gap-3">
                                <span className="font-semibold">Results</span>
                                <span className="text-sm text-muted-foreground">
                                  {testResults.filter(r => r.passed).length} / {testResults.length} passed
                                </span>
                              </div>

                              <div className="overflow-auto bg-card rounded">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="text-left">
                                      <th className="px-3 py-2">#</th>
                                      <th className="px-3 py-2">Input</th>
                                      <th className="px-3 py-2">Expected</th>
                                      <th className="px-3 py-2">Actual</th>
                                      <th className="px-3 py-2">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {testResults.map((t) => (
                                      <tr key={t.index} className="border-t">
                                        <td className="px-3 py-2 align-top">{t.index + 1}</td>
                                        <td className="px-3 py-2 align-top"><pre className="whitespace-pre-wrap font-mono">{t.input}</pre></td>
                                        <td className="px-3 py-2 align-top"><pre className="whitespace-pre-wrap font-mono">{t.expected}</pre></td>
                                        <td className="px-3 py-2 align-top">
                                          {t.error ? (
                                            <pre className="whitespace-pre-wrap font-mono text-red-500">{t.error}</pre>
                                          ) : (
                                            <pre className="whitespace-pre-wrap font-mono">{t.actual}</pre>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                          {t.passed ? (
                                            <div className="flex items-center gap-2 text-green-600">
                                              <CheckCircle className="h-5 w-5" /> Passed
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-2 text-red-600">
                                              <XCircle className="h-5 w-5" /> Failed
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </TabsContent>
                      </Tabs>
                    </Panel>
                  </PanelGroup>
                </div>
              </Panel>
            </PanelGroup>
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}

/* ---------------------------
   Timer component (interactive + persists endTimestamp locally)
   --------------------------- */
function ContestTimer({
  duration,
  contestId,
  userId,
  onTimeUp,
}: {
  duration: number;
  contestId?: string;
  userId?: string | null;
  onTimeUp: () => void;
}) {
  const timerKey = `contest_end:${contestId}:${userId ?? "anon"}`;

  const readPersistedEnd = (): number => {
    try {
      const raw = localStorage.getItem(timerKey);
      if (raw) {
        const v = Number(JSON.parse(raw));
        if (!Number.isNaN(v) && v > Date.now()) return v;
      }
    } catch {}
    return Date.now() + duration * 60 * 1000;
  };

  const [endTs, setEndTs] = useState<number>(() => readPersistedEnd());
  const [timeLeft, setTimeLeft] = useState<number>(() => Math.max(0, Math.round((readPersistedEnd() - Date.now()) / 1000)));
  const [openControls, setOpenControls] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(timerKey, JSON.stringify(endTs));
    } catch {}
    setTimeLeft(Math.max(0, Math.round((endTs - Date.now()) / 1000)));
  }, [endTs, timerKey]);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.round((endTs - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) onTimeUp();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTs, onTimeUp]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const addMinutesLocal = (mins: number) => {
    setEndTs((prev) => {
      const next = prev + mins * 60 * 1000;
      try { localStorage.setItem(timerKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const trySyncFromServer = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/contest-end?contestId=${encodeURIComponent(contestId ?? "")}`);
      if (!res.ok) throw new Error("Server sync failed");
      const data = await res.json();
      if (data?.endTimestamp && Number(data.endTimestamp) > Date.now()) {
        setEndTs(Number(data.endTimestamp));
      } else {
        throw new Error("Invalid server endTimestamp");
      }
    } catch (err: any) {
      alert("Sync failed: " + (err?.message ?? "unknown"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpenControls((s) => !s)}
        className={`flex items-center gap-2 font-mono text-lg font-semibold p-2 rounded-md ${
          timeLeft < 300 ? "text-destructive animate-pulse" : ""
        }`}
        title="Click to open timer controls"
      >
        <Clock className="h-5 w-5" />
        <span>{formatTime(timeLeft)}</span>
      </button>

      {openControls && (
        <div className="absolute right-0 mt-2 w-44 bg-card border rounded p-3 shadow">
          <div className="text-sm mb-2">Timer controls</div>
          <div className="flex gap-2">
            <button className="px-2 py-1 rounded bg-muted hover:bg-muted-foreground/20 text-sm" onClick={() => addMinutesLocal(5)}>
              +5 min
            </button>
            <button
              className="px-2 py-1 rounded bg-muted hover:bg-muted-foreground/20 text-sm"
              onClick={trySyncFromServer}
              disabled={syncing}
            >
              {syncing ? "Syncing..." : "Sync"}
            </button>
          </div>
          <div className="text-xs text-muted-foreground mt-2">Local changes only until server is updated.</div>
        </div>
      )}
    </div>
  );
}
