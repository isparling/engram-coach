# Shared retrieval policy (qmd)

How to search the athlete's coaching corpus. **This is the only copy — do not
inline it into a skill.**

---

## The rule

**Query the question you actually need answered. Never query the skill's own
name or topic.**

Topic-word queries retrieve by keyword and match everything and nothing. The
corpus is entirely about coaching, so "coaching adaptation history" describes
every document in it and discriminates between none of them.

Measured on this corpus:

| Query | Result |
|---|---|
| `qmd query "coaching adaptation history"` | Returned a *stale copy of the adapt-plan skill file* at 93% — the skill retrieving its own superseded instructions as history |
| `qmd query "does the athlete overshoot prescribed easy buffer spin duration"` | Returned the exact W3 Tue buffer record that documents the pattern, at 56% |

Same corpus, same tool. The difference is that the second is a question.

## Constructing queries

Derive **2–3 queries from the specific decision in front of you**, not from the
skill you are running. Include the concrete particulars — session type, the
numbers observed, the anomaly, the block name, the symptom.

Cover two levels:

1. **Durable pattern** — "has this athlete shown X before?" Surfaces the claim
   records under `claims/`, `lessons-log.md`, block summaries, race reports.
2. **Session precedent** — "what happened last time X occurred in Y?" Surfaces
   adaptation records and consultations.

Good:

- `qmd query "has HR run high for power on warm under-slept indoor mornings"`
- `qmd query "how did the athlete respond to sweet spot the week after a long ride"`
- `qmd query "prior cold weather hand numbness on the bike"`

Bad — do not write queries like these:

- `qmd query "adapt plan build1"` · `qmd query "coaching adaptation history"`
  · `qmd vsearch "coaching"` · `qmd query "{skill name}"`

## Choosing the command

| Command | Use for |
|---|---|
| `qmd query` | **Default.** Hybrid lexical + vector with expansion and reranking. |
| `qmd search` | Exact terms, numbers, dates, source tags — e.g. `"165W"`, `"i143346"`. |
| `qmd vsearch` | Only when you can describe the idea but not name its keywords. |

Add `-n <num>` for more results; `-c training` to pin the collection.

## Reading results

- **Cite the source tag** of anything you rely on, so the athlete can trace it.
- **Respect confidence grading.** A record marked provisional or
  single-observation does not become established by being retrieved.
- **Nothing above ~45% means nothing relevant was found.** Say so. Do not
  stretch a weak match into a precedent — a wrong precedent is worse than none,
  because it launders a coincidence into a pattern.
- **Check what a document *is* before trusting it.** Process documents, task
  briefs, and drafts are keyword-dense and can outrank real records. Only
  `docs/` in the athlete repo is indexed knowledge; if a result looks like
  planning or creative output, discount it.
