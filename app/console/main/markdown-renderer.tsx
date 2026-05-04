'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function flattenMarkdown(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-name>[^<]*<\/command-name>/g, '')
    .replace(/<command-message>[^<]*<\/command-message>/g, '')
    .replace(/<command-args>[^<]*<\/command-args>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<system-reminder>[\s\S]*/g, '');
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
