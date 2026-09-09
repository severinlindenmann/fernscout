import { parseAnswer, type AnswerBlock, type AnswerInline } from "@/lib/helper/answer";

/**
 * The model's own prose, drawn from the four marks `lib/helper/answer.ts`
 * knows — B1120. Everywhere a `say` block reaches the screen (the fallback in
 * `components/HelperAsk.tsx`), this is what draws it instead of the raw
 * string, so `**bold**` stops being read out loud as two asterisks and a
 * day's own words sit in their own marked block.
 */
export default function AnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseAnswer(text).map((block, i) => (
        <AnswerBlockView key={i} block={block} />
      ))}
    </div>
  );
}

function Runs({ parts }: { parts: AnswerInline[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.bold ? (
          <strong key={i} className="font-semibold text-navy-900">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function AnswerBlockView({ block }: { block: AnswerBlock }) {
  if (block.kind === "meta") {
    return <p className="text-sm text-navy-500">{block.text}</p>;
  }
  if (block.kind === "quote") {
    return (
      <blockquote className="border-l-4 border-yellow-400 pl-3">
        {block.lines.map((line, i) => (
          <p key={i} className="text-base leading-6 text-navy-600">
            <Runs parts={line} />
          </p>
        ))}
      </blockquote>
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {block.items.map((item, i) => (
          <li key={i} className="text-base leading-6 text-navy-800">
            <Runs parts={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="text-base leading-6 text-navy-800">
      <Runs parts={block.parts} />
    </p>
  );
}
