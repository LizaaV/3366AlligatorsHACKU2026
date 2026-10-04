/**
 * A skill run is sent as a plain sentence, `Run “Greenness check” on Hyde Park` (the guard
 * reads it as a normal question), and shown as its command: "/greenness-check" in blue, then
 * "on Hyde Park". Anything else is shown as typed. Chats restored from the server match too.
 */

export interface SkillName {
  id: string;
  name: string;
}

/** The skill and the rest of the sentence, when `text` is a skill run. */
export function skillCommand(text: string, skills: SkillName[]): { id: string; rest: string } | null {
  const m = /^Run “(.+?)” on (.+)$/.exec(text);
  const skill = m && skills.find((s) => s.name === m[1]);
  return m && skill ? { id: skill.id, rest: m[2] } : null;
}

export function QuestionText({ text, skills }: { text: string; skills: SkillName[] }) {
  const cmd = skillCommand(text, skills);
  if (!cmd) return <>{text}</>;
  return (
    <>
      <span style={{ color: 'var(--blue-hover)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.93em' }}>/{cmd.id}</span> on {cmd.rest}
    </>
  );
}
