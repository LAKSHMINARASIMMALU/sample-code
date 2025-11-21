import { NextResponse } from 'next/server';

type ReqBody = {
  language: string;   // e.g. "python3", "javascript"
  code: string;
  stdin?: string;
  version?: string;   // optional
};

export async function POST(req: Request) {
  try {
    const body: ReqBody = await req.json();

    // basic validation
    if (!body.language || !body.code) {
      return NextResponse.json({ error: 'language and code are required' }, { status: 400 });
    }

    // Piston public endpoint (or your self-hosted url)
    const PISTON_URL = process.env.PISTON_URL || 'https://emkc.org/api/v2/piston/execute';

    const res = await fetch(PISTON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: body.language,
        version: body.version || '*',
        files: [{ name: 'main', content: body.code }],
        stdin: body.stdin || '',
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json({ error: 'Piston error', details: txt }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Execute error:', err);
    return NextResponse.json({ error: err.message || 'unknown error' }, { status: 500 });
  }
}
