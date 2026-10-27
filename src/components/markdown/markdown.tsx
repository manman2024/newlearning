type MarkdownProps = {
  markup: string;
  className?: string;
};
/**
 * Renders markdown component
 * https://tanstack.dev/start/latest/docs/framework/react/guide/rendering-markdown
 */
export function Markdown({ markup, className }: MarkdownProps) {
  // `markup` is generated from trusted repository content by the route loader.
  // Rendering it directly keeps the component compatible with Worker SSR,
  // where browser DOM APIs such as document.implementation are unavailable.
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: markup }} />
  );
}
