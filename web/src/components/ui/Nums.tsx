/** Plain text with its numbers, times and dates isolated for RTL (`.num`). */
export function Nums({ text }: { text: string }) {
  return text.split(/(\d[\d:.–]*\d|\d)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="num">
        {part}
      </span>
    ) : (
      part
    ),
  )
}
