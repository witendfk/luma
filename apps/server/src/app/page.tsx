const features = [
  ['鉴权与账号', '/api/auth/wechat/login · /api/auth/me · /api/auth/logout'],
  ['会话与消息', '/api/conversations · /api/conversations/:id/turns (SSE)'],
  ['学习材料', '/api/artifacts/:id · /api/jobs/:id'],
  ['练习闭环', '/api/practice-attempts · submit · complete'],
  ['错题收藏', '/api/collections'],
];

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 24px' }}>
      <p
        style={{
          fontSize: 12,
          letterSpacing: '0.2em',
          color: '#a08464',
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        LUMA · 学生版
      </p>
      <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 500, margin: '8px 0 4px' }}>
        服务端已在运行
      </h1>
      <p style={{ color: '#4f6652', marginTop: 0 }}>
        小程序与任务执行进程通过 /api 访问本服务；健康检查见{' '}
        <a href="/api/health" style={{ color: '#4f6652' }}>
          /api/health
        </a>
        。
      </p>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 32, borderTop: '1px solid #dde2d4' }}>
        {features.map(([name, endpoints]) => (
          <li
            key={name}
            style={{ padding: '12px 0', borderBottom: '1px solid #dde2d4', fontSize: 14 }}
          >
            <strong style={{ marginRight: 12 }}>{name}</strong>
            <code style={{ color: '#4f6652', fontSize: 12 }}>{endpoints}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
