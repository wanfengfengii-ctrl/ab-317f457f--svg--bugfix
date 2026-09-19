import { useMemo, useState } from 'react';
import {
  decodePulses,
  decodeWithTau,
  validateInput,
  TAU_MIN,
  TAU_MAX,
  type Overall,
  type InputError,
} from './decode';
import { encodeDigits } from './encode';
import PulseDiagram from './PulseDiagram';

interface View {
  errors: InputError[];
  durations: number[] | null;
  outcome: Overall | null;
}

export default function App() {
  const [text, setText] = useState('');

  const view = useMemo<View>(() => {
    const trimmed = text.trim();
    if (trimmed === '') return { errors: [], durations: null, outcome: null };
    // 校验失败即整份拒绝：不产出任何旧/新解码结果
    const { pulses, errors } = validateInput(trimmed);
    if (pulses === null) return { errors, durations: null, outcome: null };
    return { errors: [], durations: pulses, outcome: decodePulses(pulses) };
  }, [text]);

  const sweep = useMemo(() => {
    if (!view.durations) return [];
    const out: { tau: number; ok: boolean; reason?: string; digits?: string }[] = [];
    for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
      const r = decodeWithTau(tau, view.durations);
      out.push(r.ok ? { tau, ok: true, digits: r.digits } : { tau, ok: false, reason: r.reason });
    }
    return out;
  }, [view.durations]);

  return (
    <main className="page">
      <header>
        <h1>磁标读头脉冲串解码器</h1>
        <p className="subtitle">
          纯浏览器计算 · 枚举整数时钟 τ = {TAU_MIN}..{TAU_MAX}µs，判定数字串是否唯一
        </p>
      </header>

      <section className="panel">
        <label htmlFor="pulse-input" className="input-label">
          输入：{`6..200`} 个 {`20..150`} 微秒整数的 JSON 数组
        </label>
        <textarea
          id="pulse-input"
          data-testid="pulse-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={4}
          placeholder='[100, 50, 50, 100, ...]'
        />
        <div className="btn-row">
          <button type="button" data-testid="sample-decoded" onClick={() => setText(JSON.stringify(encodeDigits('48321', 96)))}>
            示例：可解码
          </button>
          <button type="button" data-testid="sample-drift" onClick={() => setText(JSON.stringify(encodeDigits('707', 118)))}>
            示例：漂移时钟
          </button>
          <button
            type="button"
            data-testid="sample-unreadable"
            onClick={() => setText(JSON.stringify([...encodeDigits('48321', 96), 50]))}
          >
            示例：孤立短型
          </button>
          <button type="button" onClick={() => setText('')}>清空</button>
        </div>
      </section>

      {view.errors.length > 0 && (
        <section className="panel error-panel" data-testid="input-errors">
          <h2>输入错误（整份拒绝，不保留旧结果）</h2>
          <ul>
            {view.errors.map((e, i) => (
              <li key={i} data-testid="error-item" data-pos={e.pos}>
                {e.pos >= 0 ? <span className="err-pos">第 {e.pos + 1} 项：</span> : <span className="err-pos">整份：</span>}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.outcome && <Result outcome={view.outcome} durations={view.durations!} />}

      {sweep.length > 0 && <TauSweep rows={sweep} />}
    </main>
  );
}

function Result({ outcome, durations }: { outcome: Overall; durations: number[] }) {
  if (outcome.status === 'unreadable') {
    return (
      <section className="panel result" data-testid="result-panel">
        <h2>
          判定：<span className="badge badge-unreadable" data-testid="result-status">unreadable</span>
        </h2>
        <p className="hint">τ = {TAU_MIN}..{TAU_MAX} 中没有任何时钟能得到合法帧。</p>
      </section>
    );
  }

  if (outcome.status === 'ambiguous') {
    return (
      <section className="panel result" data-testid="result-panel">
        <h2>
          判定：<span className="badge badge-ambiguous" data-testid="result-status">ambiguous</span>
        </h2>
        <p className="hint">不同 τ 解出了多个不同数字串（按数字串字典序排列）：</p>
        <table className="amb-table">
          <thead>
            <tr><th>数字串</th><th>成立的 τ（µs）</th></tr>
          </thead>
          <tbody>
            {outcome.entries.map((e) => (
              <tr key={e.digits} data-testid="ambiguous-entry">
                <td className="digits" data-testid="amb-digits">{e.digits}</td>
                <td data-testid="amb-taus">{e.taus.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section className="panel result" data-testid="result-panel">
      <h2>
        判定：<span className="badge badge-decoded" data-testid="result-status">decoded</span>
      </h2>
      <div className="result-grid">
        <div>
          <div className="field-label">数字串</div>
          <div className="digits big" data-testid="result-digits">{outcome.digits}</div>
        </div>
        <div>
          <div className="field-label">成立的 τ（µs）</div>
          <div className="tau-list" data-testid="result-tau">{outcome.taus.join(', ')}</div>
          <div className="hint">
            共 {outcome.taus.length} 个 τ 有效；按最小 τ = <strong>{outcome.min.tau}</strong> 绘制分类与成位。
          </div>
        </div>
      </div>
      <PulseDiagram durations={durations} result={outcome.min} />
      <table className="codes-table" data-testid="codes-table">
        <thead>
          <tr><th>角色</th><th>码值</th><th>5 位（低→高，末位奇校验）</th></tr>
        </thead>
        <tbody>
          {outcome.min.groups.map((g, i) => (
            <tr key={i}>
              <td>{roleName(i, outcome.min.groups.length)}</td>
              <td>{g.value}</td>
              <td className="mono">{g.bits.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function roleName(i: number, n: number): string {
  if (i === 0) return '起始码';
  if (i === n - 1) return 'LRC';
  if (i === n - 2) return '结束码';
  return `载荷 ${i}`;
}

function TauSweep({ rows }: { rows: { tau: number; ok: boolean; reason?: string; digits?: string }[] }) {
  const okCount = rows.filter((r) => r.ok).length;
  return (
    <details className="panel sweep">
      <summary data-testid="sweep-summary">τ 枚举明细（{okCount}/{rows.length} 有效）</summary>
      <table className="sweep-table">
        <thead>
          <tr><th>τ (µs)</th><th>结果</th><th>说明</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tau} data-testid="sweep-row" data-ok={r.ok ? '1' : '0'}>
              <td className="mono">{r.tau}</td>
              <td>{r.ok ? '✓ 有效' : '✗ 淘汰'}</td>
              <td>{r.ok ? `数字串 ${r.digits}` : r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
