import { Fragment } from "react";

const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

/** The chat API's light markup: *bold*, _italic_ and ~strike~; blank lines
 * are paragraph breaks. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => (
        <p key={p} className="mt-3 first:mt-0">
          {para.split("\n").map((line, l) => (
            <Fragment key={l}>
              {l > 0 && <br />}
              {line.split(INLINE).map((part, k) => {
                const inner = part.slice(1, -1);
                if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <strong key={k}>{inner}</strong>;
                if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <em key={k}>{inner}</em>;
                if (part.length > 2 && part.startsWith("~") && part.endsWith("~")) return <s key={k}>{inner}</s>;
                return <Fragment key={k}>{part}</Fragment>;
              })}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}
