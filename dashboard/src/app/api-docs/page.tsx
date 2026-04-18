'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

interface ServiceEntry {
  readonly id: 'policy-service' | 'compliance-api' | 'prover-service' | 'agent-service';
  readonly label: string;
  readonly publicUrl: string;
  readonly port: string;
  readonly tagline: string;
  readonly accent: string;
}

interface OpenApiSchemaRef { readonly $ref: string }
interface OpenApiSchemaObject { readonly [key: string]: unknown }
type OpenApiSchema = OpenApiSchemaRef | OpenApiSchemaObject;

interface OpenApiParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: OpenApiSchema;
}

interface OpenApiOperation {
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly content?: Record<string, { schema?: OpenApiSchema }>;
  };
  readonly responses?: Record<string, {
    readonly description?: string;
    readonly content?: Record<string, { schema?: OpenApiSchema }>;
  }>;
}

interface OpenApiSpec {
  readonly openapi?: string;
  readonly info?: { title?: string; version?: string; description?: string };
  readonly paths?: Record<string, Record<string, OpenApiOperation>>;
  readonly components?: { schemas?: Record<string, OpenApiSchemaObject> };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];

function methodColor(method: Method): string {
  switch (method) {
    case 'get': return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300';
    case 'post': return 'bg-amber-500/10 border-amber-500/40 text-amber-300';
    case 'put': return 'bg-blue-500/10 border-blue-500/40 text-blue-300';
    case 'patch': return 'bg-purple-500/10 border-purple-500/40 text-purple-300';
    case 'delete': return 'bg-red-500/10 border-red-500/40 text-red-300';
  }
}

function resolveRef(spec: OpenApiSpec, ref: string): OpenApiSchemaObject | null {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return null;
  return spec.components?.schemas?.[match[1]!] ?? null;
}

function renderSchema(spec: OpenApiSpec, schema: OpenApiSchema | undefined, depth = 0): string {
  if (!schema || depth > 4) return '…';
  if ('$ref' in schema && typeof schema.$ref === 'string') {
    const resolved = resolveRef(spec, schema.$ref);
    return resolved ? renderSchema(spec, resolved, depth + 1) : schema.$ref;
  }
  const s = schema as OpenApiSchemaObject;
  if (s.type === 'object' && s.properties) {
    const props = s.properties as Record<string, OpenApiSchema>;
    const required = (s.required as string[] | undefined) ?? [];
    const entries = Object.entries(props).map(([key, val]) => {
      const line = renderSchema(spec, val, depth + 1);
      const mark = required.includes(key) ? '*' : '';
      return `  ${'  '.repeat(depth)}${key}${mark}: ${line}`;
    });
    return `{\n${entries.join(',\n')}\n${'  '.repeat(depth)}}`;
  }
  if (s.type === 'array') {
    const items = s.items as OpenApiSchema | undefined;
    return `Array<${renderSchema(spec, items, depth + 1)}>`;
  }
  const fmt = s.format ? ` (${s.format})` : '';
  const enumVals = Array.isArray(s.enum) ? ` ∈ [${(s.enum as unknown[]).map(String).join('|')}]` : '';
  return `${String(s.type ?? 'any')}${fmt}${enumVals}`;
}

function buildCurl(method: Method, baseUrl: string, path: string, op: OpenApiOperation): string {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const lines: string[] = [`curl -X ${method.toUpperCase()} "${url}"`];
  const contentType = op.requestBody?.content ? Object.keys(op.requestBody.content)[0] : null;
  if (contentType) {
    lines.push(`  -H "Content-Type: ${contentType}"`);
    if (contentType === 'application/json') {
      lines.push(`  -d '<request body json>'`);
    }
  }
  return lines.join(' \\\n');
}

function extractPort(url: string): string {
  try {
    const u = new URL(url);
    if (u.port) return u.port;
    if (u.protocol === 'https:') return '443';
    return '80';
  } catch {
    return '—';
  }
}

const POLICY_URL = process.env.NEXT_PUBLIC_POLICY_SERVICE_URL ?? 'http://localhost:3001';
const COMPLIANCE_URL = process.env.NEXT_PUBLIC_COMPLIANCE_API_URL ?? 'http://localhost:3002';
const PROVER_URL = process.env.NEXT_PUBLIC_PROVER_SERVICE_URL ?? 'http://localhost:3003';
const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ?? 'http://localhost:3004';

const SERVICES: readonly ServiceEntry[] = [
  {
    id: 'policy-service',
    label: 'Policy Service',
    publicUrl: POLICY_URL,
    port: extractPort(POLICY_URL),
    tagline: 'Policy CRUD, auth, API keys',
    accent: 'emerald',
  },
  {
    id: 'compliance-api',
    label: 'Compliance API',
    publicUrl: COMPLIANCE_URL,
    port: extractPort(COMPLIANCE_URL),
    tagline: 'Attestations, x402 & MPP',
    accent: 'amber',
  },
  {
    id: 'prover-service',
    label: 'Prover Service',
    publicUrl: PROVER_URL,
    port: extractPort(PROVER_URL),
    tagline: 'RISC Zero zkVM prover',
    accent: 'blue',
  },
  {
    id: 'agent-service',
    label: 'Agent Service',
    publicUrl: AGENT_URL,
    port: extractPort(AGENT_URL),
    tagline: 'Autonomous agent control',
    accent: 'purple',
  },
];

function accentClasses(accent: string, active: boolean): string {
  const map: Record<string, { dot: string; bg: string; text: string }> = {
    emerald: { dot: 'bg-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/40', text: 'text-emerald-300' },
    amber: { dot: 'bg-amber-400', bg: 'bg-amber-400/10 border-amber-400/40', text: 'text-amber-300' },
    blue: { dot: 'bg-blue-400', bg: 'bg-blue-400/10 border-blue-400/40', text: 'text-blue-300' },
    purple: { dot: 'bg-purple-400', bg: 'bg-purple-400/10 border-purple-400/40', text: 'text-purple-300' },
  };
  const m = map[accent] ?? map.amber!;
  if (active) return `${m.bg} ${m.text}`;
  return 'border-transparent text-amber-100/80 hover:text-amber-100 hover:bg-amber-400/5';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }, [text]);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400/75 hover:text-amber-400 transition-colors"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Endpoint({ method, path, op, spec, baseUrl }: { method: Method; path: string; op: OpenApiOperation; spec: OpenApiSpec; baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const curl = useMemo(() => buildCurl(method, baseUrl, path, op), [method, baseUrl, path, op]);

  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  const responses = Object.entries(op.responses ?? {}) as [string, { description?: string; content?: Record<string, { schema?: OpenApiSchema }> }][];

  return (
    <div className="rounded-lg border border-amber-400/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-400/5 transition-colors text-left"
      >
        {open ? <ChevronDown size={14} className="text-amber-400/75 flex-shrink-0" /> : <ChevronRight size={14} className="text-amber-400/75 flex-shrink-0" />}
        <span className={`text-[11px] font-mono uppercase px-2 py-0.5 rounded border ${methodColor(method)} flex-shrink-0`}>
          {method}
        </span>
        <span className="font-mono text-sm text-amber-100 flex-shrink-0">{path}</span>
        {op.summary && <span className="text-xs text-amber-400/70 truncate">{op.summary}</span>}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-amber-400/10 space-y-4">
          {op.description && (
            <p className="text-xs text-amber-400/75 leading-relaxed pt-3">{op.description}</p>
          )}

          {op.parameters && op.parameters.length > 0 && (
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-wider text-amber-400/70 mb-2">Parameters</h4>
              <div className="space-y-1.5">
                {op.parameters.map((p) => (
                  <div key={`${p.in}-${p.name}`} className="flex items-baseline gap-2 text-xs font-mono">
                    <span className="text-amber-300">{p.name}</span>
                    <span className="text-amber-400/60">({p.in}{p.required ? ', required' : ''})</span>
                    <span className="text-amber-400/75">{renderSchema(spec, p.schema)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {bodySchema && (
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-wider text-amber-400/70 mb-2">Request body</h4>
              <pre className="bg-[#0a0a0a] border border-amber-400/10 rounded p-3 text-[11px] font-mono text-amber-200 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {renderSchema(spec, bodySchema)}
              </pre>
            </div>
          )}

          {responses.length > 0 && (
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-wider text-amber-400/70 mb-2">Responses</h4>
              <div className="space-y-2">
                {responses.map(([code, resp]) => {
                  const schema = resp.content?.['application/json']?.schema;
                  const statusClass = code.startsWith('2') ? 'text-emerald-300' : code.startsWith('4') ? 'text-amber-300' : code.startsWith('5') ? 'text-red-300' : 'text-amber-400/75';
                  return (
                    <div key={code}>
                      <div className={`font-mono text-xs ${statusClass} mb-1`}>
                        {code} — <span className="text-amber-400/70">{resp.description ?? ''}</span>
                      </div>
                      {schema && (
                        <pre className="bg-[#0a0a0a] border border-amber-400/10 rounded p-3 text-[11px] font-mono text-amber-200 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {renderSchema(spec, schema)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-mono text-[11px] uppercase tracking-wider text-amber-400/70">Example</h4>
              <CopyButton text={curl} />
            </div>
            <pre className="bg-[#0a0a0a] border border-amber-400/10 rounded p-3 text-[11px] font-mono text-amber-200 overflow-x-auto whitespace-pre leading-relaxed">
              {curl}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [activeService, setActiveService] = useState<ServiceEntry['id']>('policy-service');
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSpec(null);
    fetch(`/api/docs/${activeService}/spec`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<OpenApiSpec>;
      })
      .then((json) => {
        if (!cancelled) setSpec(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeService]);

  const activeEntry = SERVICES.find((s) => s.id === activeService)!;
  const pathEntries = Object.entries(spec?.paths ?? {}) as [string, Record<string, OpenApiOperation>][];

  return (
    <main className="relative min-h-screen bg-[#000000] flex flex-col">
      <Navbar />

      <section className="relative z-10 flex-1 pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 mb-2">API Documentation</h1>
            <p className="text-sm text-amber-400/70">Live OpenAPI 3.0 specs fetched from each backend service at runtime.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
            {/* Sidebar */}
            <aside className="lg:sticky lg:top-24 self-start space-y-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/75 px-1">
                Services
              </p>
              <nav className="space-y-2">
                {SERVICES.map((svc) => {
                  const active = activeService === svc.id;
                  const cls = accentClasses(svc.accent, active);
                  const dotCls: Record<string, string> = {
                    emerald: 'bg-emerald-400',
                    amber: 'bg-amber-400',
                    blue: 'bg-blue-400',
                    purple: 'bg-purple-400',
                  };
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => setActiveService(svc.id)}
                      className={`w-full text-left rounded-lg border px-3.5 py-3 font-mono transition-colors ${cls}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-sm font-semibold">
                          <span className={`w-1.5 h-1.5 rounded-full ${dotCls[svc.accent] ?? 'bg-amber-400'}`} />
                          {svc.label}
                        </span>
                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${active ? 'border-current/40' : 'border-amber-400/20 text-amber-400/70'}`}>
                          :{svc.port}
                        </span>
                      </div>
                      <p className={`mt-1.5 text-[11px] ${active ? 'opacity-80' : 'text-amber-100/55'}`}>
                        {svc.tagline}
                      </p>
                    </button>
                  );
                })}
              </nav>
              <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 px-3.5 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/70">Base URL</p>
                <p className="mt-1 font-mono text-[11px] text-amber-200 break-all">{activeEntry.publicUrl}</p>
              </div>
            </aside>

            {/* Content */}
            <div>
              {loading && (
                <div className="flex items-center gap-3 text-amber-400/75 text-sm font-mono">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading {activeEntry.label} spec…
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-mono text-sm font-semibold text-red-300">Could not load spec</p>
                    <p className="text-xs text-red-300/70 mt-1">{error}</p>
                  </div>
                </div>
              )}
              {spec && !loading && (
                <div className="space-y-6">
                  <div>
                    <h2 className="font-mono text-xl font-semibold text-amber-100">{spec.info?.title ?? activeEntry.label}</h2>
                    {spec.info?.version && (
                      <p className="text-xs font-mono text-amber-400/70 mt-1">v{spec.info.version}</p>
                    )}
                    {spec.info?.description && (
                      <p className="text-sm text-amber-400/75 mt-3 leading-relaxed">{spec.info.description}</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    {pathEntries.length === 0 && (
                      <p className="text-xs text-amber-400/60 font-mono">No paths declared.</p>
                    )}
                    {pathEntries.map(([path, ops]) => (
                      <div key={path} className="space-y-2">
                        {METHODS.filter((m) => ops[m]).map((method) => (
                          <Endpoint
                            key={`${method}-${path}`}
                            method={method}
                            path={path}
                            op={ops[method]!}
                            spec={spec}
                            baseUrl={activeEntry.publicUrl}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
