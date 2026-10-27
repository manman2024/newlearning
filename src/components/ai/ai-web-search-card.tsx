import { IconLoader2, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { searchWeb } from '@/api/ai';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { WEB_SEARCH_PROVIDERS, type WebSearchResult } from '@/lib/web-search';
import { m } from '@/locale/paraglide/messages';

const PROVIDER_LABELS = { ceramic: 'Ceramic.ai', exa: 'Exa', linkup: 'Linkup' };

export function AiWebSearchCard() {
  const [query, setQuery] = useState<string>(m.ai_web_search_sample_1());
  const [provider, setProvider] =
    useState<(typeof WEB_SEARCH_PROVIDERS)[number]>('ceramic');
  const [result, setResult] = useState<WebSearchResult>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  function clear() {
    setResult(undefined);
    setError(undefined);
  }
  async function search() {
    clear();
    setPending(true);
    try {
      setResult(await searchWeb({ data: { query, provider } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : m.ai_web_search_error());
    } finally {
      setPending(false);
    }
  }
  const presets = [
    [m.ai_web_search_preset_1(), m.ai_web_search_sample_1()],
    [m.ai_web_search_preset_2(), m.ai_web_search_sample_2()],
    [m.ai_web_search_preset_3(), m.ai_web_search_sample_3()],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconSearch className="size-5 text-primary" />
          {m.ai_web_search_title()}
        </CardTitle>
        <CardDescription>{m.ai_web_search_description()}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <Label htmlFor="ai-web-search-provider">
            {m.ai_web_search_provider()}
          </Label>
          <Select
            items={WEB_SEARCH_PROVIDERS.map((value) => ({
              value,
              label: PROVIDER_LABELS[value],
            }))}
            value={provider}
            disabled={pending}
            onValueChange={(value) => {
              if (value) setProvider(value);
              clear();
            }}
          >
            <SelectTrigger
              id="ai-web-search-provider"
              data-testid="ai-web-search-provider"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEB_SEARCH_PROVIDERS.map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  label={PROVIDER_LABELS[value]}
                >
                  {PROVIDER_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>{m.ai_web_search_presets()}</Label>
          <div className="flex flex-wrap gap-2">
            {presets.map(([label, sample], index) => (
              <Button
                key={label}
                data-testid={`ai-web-search-preset-${index}`}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setQuery(sample);
                  clear();
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Label htmlFor="ai-web-search-query">{m.ai_web_search_query()}</Label>
          <Textarea
            id="ai-web-search-query"
            data-testid="ai-web-search-query"
            rows={5}
            maxLength={1024}
            value={query}
            disabled={pending}
            onChange={(event) => {
              setQuery(event.target.value);
              clear();
            }}
          />
          <Button
            data-testid="ai-web-search-submit"
            disabled={pending || !query.trim()}
            onClick={search}
          >
            {pending && <IconLoader2 className="mr-1 size-4 animate-spin" />}
            {pending ? m.ai_web_search_pending() : m.ai_web_search_action()}
          </Button>
        </div>
        <div
          className="max-h-[480px] space-y-4 overflow-y-auto rounded-md border bg-muted/30 p-4 text-sm"
          aria-live="polite"
        >
          {error ? (
            <p data-testid="ai-web-search-error" className="text-destructive">
              {error}
            </p>
          ) : result ? (
            result.items.length ? (
              result.items.map((item, index) => (
                <article
                  key={item.url}
                  data-testid="ai-web-search-result"
                  className="flex gap-3"
                >
                  <span className="text-muted-foreground">{index + 1}.</span>
                  <div className="min-w-0 space-y-1">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-words font-medium text-primary underline underline-offset-4"
                    >
                      {item.title || item.url}
                    </a>
                    <p className="break-all text-xs text-muted-foreground">
                      {item.url}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <p data-testid="ai-web-search-no-results">
                {m.ai_web_search_no_results()}
              </p>
            )
          ) : (
            <p className="text-muted-foreground">{m.ai_web_search_empty()}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
