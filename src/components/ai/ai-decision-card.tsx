import { IconRoute } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { evaluateTicket } from '@/api/ai';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CLEF_MODELS } from '@/config/ai-models';
import type { ClefTicketResult } from '@/lib/clef';
import { m } from '@/locale/paraglide/messages';

export function AiDecisionCard() {
  const [state, setState] = useState<string>(m.ai_decision_sample_outage());
  const [model, setModel] = useState<(typeof CLEF_MODELS)[number]>('clef');
  const [result, setResult] = useState<ClefTicketResult>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function evaluate() {
    setPending(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await evaluateTicket({ data: { state, model } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : m.ai_decision_error());
    } finally {
      setPending(false);
    }
  }
  const presets = [
    [m.ai_decision_outage(), m.ai_decision_sample_outage()],
    [m.ai_decision_refund(), m.ai_decision_sample_refund()],
    [m.ai_decision_upgrade(), m.ai_decision_sample_upgrade()],
  ];
  const teamLabels = {
    billing: m.ai_decision_billing(),
    technical: m.ai_decision_technical(),
    sales: m.ai_decision_sales(),
  };
  const severityLabels: Record<string, string> = {
    '0': m.ai_decision_impact_none(),
    '1': m.ai_decision_impact_minor(),
    '2': m.ai_decision_impact_major(),
    '3': m.ai_decision_impact_critical(),
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconRoute className="size-5 text-primary" />
          {m.ai_decision_title()}
        </CardTitle>
        <CardDescription>{m.ai_decision_description()}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <Label htmlFor="ai-decision-model">{m.ai_decision_model()}</Label>
          <Select
            items={CLEF_MODELS.map((value) => ({
              value,
              label: `@cf/cloudflare/${value}`,
            }))}
            value={model}
            disabled={pending}
            onValueChange={(value) => {
              if (value) setModel(value);
              setResult(undefined);
            }}
          >
            <SelectTrigger
              id="ai-decision-model"
              data-testid="ai-decision-model"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLEF_MODELS.map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  label={`@cf/cloudflare/${value}`}
                >
                  @cf/cloudflare/{value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>{m.ai_decision_preset()}</Label>
          <div className="flex flex-wrap gap-2">
            {presets.map(([label, sample], index) => (
              <Button
                key={label}
                data-testid={`ai-decision-preset-${index}`}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setState(sample);
                  setResult(undefined);
                  setError(undefined);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Label htmlFor="ai-decision-state">{m.ai_decision_state()}</Label>
          <Textarea
            id="ai-decision-state"
            data-testid="ai-decision-state"
            rows={7}
            maxLength={4000}
            value={state}
            disabled={pending}
            onChange={(event) => {
              setState(event.target.value);
              setResult(undefined);
            }}
          />
          <Button
            data-testid="ai-decision-submit"
            disabled={pending || state.trim().length < 10}
            onClick={evaluate}
          >
            {pending ? m.ai_decision_pending() : m.ai_decision_action()}
          </Button>
        </div>
        <div
          className="space-y-4 rounded-md border bg-muted/30 p-4 text-sm"
          aria-live="polite"
          aria-busy={pending}
        >
          {error && (
            <p
              role="alert"
              data-testid="ai-decision-error"
              className="text-destructive"
            >
              {error}
            </p>
          )}
          {result ? (
            <div data-testid="ai-decision-result" className="space-y-4">
              <DecisionAnswer number={1} title={m.ai_decision_urgent()}>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {(result.answers.urgent.noul * 100).toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground">
                    {m.ai_decision_yes_probability()}
                  </span>
                </div>
                <Progress
                  value={result.answers.urgent.noul * 100}
                  aria-label={m.ai_decision_urgent()}
                />
              </DecisionAnswer>
              <DecisionAnswer number={2} title={m.ai_decision_team()}>
                <p className="text-lg font-semibold">
                  {teamLabels[result.answers.team.choice]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.ai_decision_confidence()}{' '}
                  {(result.answers.team.confidence * 100).toFixed(1)}%
                </p>
                <div className="space-y-3 pt-1">
                  {Object.entries(result.answers.team.probabilities).map(
                    ([team, probability]) => {
                      const label = teamLabels[team as keyof typeof teamLabels];
                      return (
                        <div key={team} className="space-y-1.5">
                          <div className="flex justify-between gap-3">
                            <span
                              className={
                                team === result.answers.team.choice
                                  ? 'font-semibold'
                                  : 'text-muted-foreground'
                              }
                            >
                              {label}
                            </span>
                            <span className="tabular-nums">
                              {(probability * 100).toFixed(1)}%
                            </span>
                          </div>
                          <Progress
                            value={probability * 100}
                            aria-label={label}
                          />
                        </div>
                      );
                    }
                  )}
                </div>
              </DecisionAnswer>
              <DecisionAnswer number={3} title={m.ai_decision_severity()}>
                <p className="text-2xl font-semibold tabular-nums">
                  {result.answers.severity.score.toFixed(2)}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    / 3
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.ai_decision_score_explanation()}
                </p>
                <div className="space-y-3 pt-1">
                  {Object.entries(result.answers.severity.probabilities).map(
                    ([level, probability]) => (
                      <div key={level} className="space-y-1.5">
                        <div className="flex justify-between gap-3">
                          <span>
                            {level} · {severityLabels[level] ?? level}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {(probability * 100).toFixed(1)}%
                          </span>
                        </div>
                        <Progress
                          value={probability * 100}
                          aria-label={severityLabels[level] ?? level}
                        />
                      </div>
                    )
                  )}
                </div>
              </DecisionAnswer>
            </div>
          ) : (
            !error && (
              <p className="text-muted-foreground">{m.ai_decision_empty()}</p>
            )
          )}
          <p className="text-xs text-muted-foreground">
            {m.ai_decision_note()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionAnswer({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <h3 className="flex items-center gap-2 font-medium">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {number}
        </span>
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
