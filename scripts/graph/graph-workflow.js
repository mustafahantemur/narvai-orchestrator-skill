export const meta = {
  name: 'understand-graph',
  description: 'Understand-Anything graph: dosya gruplarını ajanlarla analiz eder, sonra katman ve tur çıkarır (aynı anda en çok 10 ajan)',
  phases: [
    { title: 'Analiz', detail: 'grup başına bir file-analyzer ajanı' },
    { title: 'Bitiriş', detail: 'gözden geçirme, katmanlar, tur' },
  ],
}

const AGENTS = args.agentDir
const ENV = `Environment: Windows with Git Bash. Run bundled scripts with \`node\`. Python is \`py\`, never \`python\`. Do not create subagents. Write only inside the project's \`.ua\` directory given below; never write anywhere else, never run a git command that changes state, never search from a filesystem root.`

const BATCH = {
  type: 'object',
  properties: {
    batchIndex: { type: 'number' },
    files: { type: 'number' },
    nodes: { type: 'number' },
    edges: { type: 'number' },
    outputs: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['batchIndex', 'files', 'nodes', 'edges', 'outputs'],
}
const DONE = {
  type: 'object',
  properties: { output: { type: 'string' }, summary: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } } },
  required: ['output', 'summary'],
}

const pool = async (items, size, run) => {
  const queue = items.slice()
  const out = []
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()
      out.push({ item, result: await run(item) })
    }
  }
  await parallel(Array.from({ length: size }, () => worker))
  return out
}

if (args.stage === 'analyze') {
  phase('Analiz')
  const items = args.projects.flatMap((p) => p.batches.map((b) => ({ label: p.label, ua: p.ua, b })))
  const analyze = (it, note) =>
    agent(
      `You are the file-analyzer subagent of the Understand-Anything pipeline.
1. Read your agent definition in full and follow it exactly: ${AGENTS}/file-analyzer.md
2. Read your dispatch prompt and execute it: ${it.ua}/intermediate/dispatch-batch-${it.b}.md
${ENV}
Summaries must say what the code does in the business domain (what rule, what data, who calls it), not restate the type name. Keep Turkish domain terms exactly as they appear in the code.
Work in as few turns as you can: read all files of a batch with parallel tool calls in one turn, never one file per turn. A dispatch may fuse several batches; each batch keeps its own output file names.
When finished, report batchIndex (the number in your dispatch file name), files analyzed, node and edge counts, and the output file names you wrote.${note || ''}`,
      { label: `${it.label} · grup ${it.b}`, phase: 'Analiz', schema: BATCH, model: args.model || 'sonnet', effort: args.effort || 'medium' },
    )
  const out = await pool(items, args.concurrency || 10, async (it) => {
    const first = await analyze(it)
    return first || (await analyze(it, '\nThis is a retry: the previous attempt for this batch returned nothing. Check whether a partial output file exists and overwrite it.'))
  })
  const failed = out.filter((x) => !x.result).map((x) => `${x.item.label}#${x.item.b}`)
  if (failed.length) log(`Sonuç dönmeyen grup: ${failed.join(', ')}`)
  return {
    stage: 'analyze',
    done: out.length - failed.length,
    failed,
    batches: out.filter((x) => x.result).map((x) => ({ project: x.item.label, ...x.result })),
  }
}

if (args.stage === 'finish') {
  phase('Bitiriş')
  const out = await pool(args.projects, args.concurrency || 10, async (p) => {
    const step = (file, what) =>
      agent(
        `You are the ${what} subagent of the Understand-Anything pipeline.
1. Read your agent definition in full and follow it exactly: ${AGENTS}/${what}.md
2. Read your dispatch prompt and execute it: ${p.ua}/intermediate/${file}
${ENV}
Report the output file you wrote and a two-sentence summary.`,
        { label: `${p.label} · ${what}`, phase: 'Bitiriş', schema: DONE, model: args.model || 'sonnet', effort: args.effort || 'high' },
      )
    const layers = await step('dispatch-architecture.md', 'architecture-analyzer')
    const tour = await step('dispatch-tour.md', 'tour-builder')
    return { layers, tour }
  })
  return { stage: 'finish', projects: out.map((x) => ({ project: x.item.label, ...x.result })) }
}

return { error: 'args.stage analyze ya da finish olmalı' }
