'use client';

import { Terminal, FileCode, Eye, Search, Globe, AlertCircle } from 'lucide-react';
import { TOOL_SEMANTICS } from '../../sdk';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─── Icon helper ────────────────────────────────────────────
export function getIcon(toolName: string) {
  const sem = TOOL_SEMANTICS[toolName];
  if (!sem) return <AlertCircle className="w-3.5 h-3.5 text-gray-500" />;
  switch (sem.icon) {
    case 'Eye':     return <Eye className="w-3.5 h-3.5 text-blue-400" />;
    case 'Search':  return <Search className="w-3.5 h-3.5 text-cyan-400" />;
    case 'Terminal': return <Terminal className="w-3.5 h-3.5 text-orange-400" />;
    case 'FileCode': return <FileCode className="w-3.5 h-3.5 text-green-400" />;
    case 'Globe':   return <Globe className="w-3.5 h-3.5 text-purple-400" />;
    default:        return <AlertCircle className="w-3.5 h-3.5 text-gray-500" />;
  }
}

// ─── Markdown helpers ───────────────────────────────────────
function flattenMarkdown(text: string): string {
  const parts: string[] = [];
  let last = 0;
  const codeRe = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    parts.push(text.slice(last, m.index));
    parts.push('\0CODE' + m[0] + '\0ENDCODE');
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  const out = parts.map((p, i) => {
    if (i % 2 === 1) return p;
    return p.split(/\n{2,}/).map(block => block.replace(/\n/g, ' ').trim()).join('\n\n');
  }).join('');
  return out.replace(/\0CODE/g, '').replace(/\0ENDCODE/g, '');
}

export function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;
  const flattened = flattenMarkdown(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const codeText = String(children).replace(/\n$/, '');
          const isInline = inline || (!codeText.includes('\n') && !className?.startsWith('language-') && codeText.length < 100);
          if (isInline) {
            return <code className="bg-gray-800 px-1 py-0.5 rounded text-[11px] text-orange-200 whitespace-nowrap" {...props}>{children}</code>;
          }
          return (
            <pre className="bg-[#0a0a0a] border border-gray-800 p-2 rounded my-1 overflow-x-auto">
              <code className="text-[11px] leading-relaxed" {...props}>{children}</code>
            </pre>
          );
        },
        a({ href, children }: any) {
          return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline decoration-blue-800/50">{children}</a>;
        },
        p({ children }: any) { return <p className="mb-0 leading-relaxed">{children}</p>; },
        ul({ children }: any) { return <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>; },
        ol({ children }: any) { return <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>; },
        li({ children }: any) { return <li className="mb-0.5">{children}</li>; },
        h1({ children }: any) { return <h1 className="text-sm font-bold mb-1 mt-2 text-gray-100">{children}</h1>; },
        h2({ children }: any) { return <h2 className="text-xs font-bold mb-1 mt-2 text-gray-100">{children}</h2>; },
        h3({ children }: any) { return <h3 className="text-[11px] font-bold mb-1 mt-1 text-gray-200">{children}</h3>; },
        blockquote({ children }: any) { return <blockquote className="border-l-2 border-gray-700 pl-2 italic text-gray-400 mb-1">{children}</blockquote>; },
        hr() { return <hr className="border-gray-800 my-2" />; },
        table({ children }: any) { return <div className="overflow-x-auto"><table className="border-collapse border border-gray-700 text-[10px] mb-1 w-full">{children}</table></div>; },
        th({ children }: any) { return <th className="border border-gray-700 px-1.5 py-0.5 font-bold text-gray-200">{children}</th>; },
        td({ children }: any) { return <td className="border border-gray-700 px-1.5 py-0.5 text-gray-300">{children}</td>; },
        strong({ children }: any) { return <strong className="font-bold text-gray-100">{children}</strong>; },
        em({ children }: any) { return <em className="italic text-gray-200">{children}</em>; },
      }}
    >
      {flattened}
    </ReactMarkdown>
  );
}

// ─── Slash commands ─────────────────────────────────────────
export const SLASH_COMMANDS = [
  { cmd: '/cost',    desc: '查看 token 消耗和预估费用', ok: true },
  { cmd: '/compact', desc: '压缩上下文释放 token', ok: true },
  { cmd: '/diff',    desc: '显示当前 Git 更改及 AI 总结', ok: true },
  { cmd: '/status',  desc: '查看会话状态（仅交互模式）', ok: false },
  { cmd: '/clear',   desc: '清空对话历史（仅交互模式）', ok: false },
  { cmd: '/model',   desc: '切换 AI 模型（仅交互模式）', ok: false },
  { cmd: '/rewind',  desc: '撤销最后一次文件修改', ok: true },
  { cmd: '/memory',  desc: '编辑 CLAUDE.md（仅交互模式）', ok: false },
];
