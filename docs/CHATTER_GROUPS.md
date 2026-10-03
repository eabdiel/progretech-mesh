# Concurrent factory conversations

When Office chatter is on, Concurrent conversations defaults to 1 and accepts whole numbers 1–4. Each conversation reserves distinct awake participants. Experimental group chat defaults off; enabling it selects three participants for newly generated discussions. Owner-requested pairs remain pairs. Existing submitted turns finish normally when settings change; disabling chatter stops subsequent turns. Background inference remains serialized under the existing shared model lock, hardware admission, owner request priority and native-work checks.

Three-agent discussions use proposer, critic and synthesizer turns. The full earlier discussion is available to later speakers. Topics include ProgreTech PWA proposals and Python library learning updates with current public documentation and small preview demo plans. Completed groups publish the final synthesis to `Rend/artifacts/rend/group-proposal-<id>.md` and notify the office Director for review with Lyra. Drafts are proposals, not approved plans, executed previews, verified library recommendations or proof of learning. Source checking and actual demo implementation remain separate orchestrated missions. Shared attributed teaching context and honest recall status are retained; private memories are excluded.

Authenticated management actions:

- `chatter.configure`: `enabled` (required bool), `session_minutes` (1–120 while enabled), `max_conversations` (1–4), `experimental_group_chat` (bool).
- `chatter.group`: `a`, `b`, `c` (distinct enrolled sibling agent IDs), `topic` (up to 200 chars). Chatter and experimental groups must be enabled. Lyra/Director orchestration can submit exact participants and topics through the existing protected Mesh management route.
- Existing `chatter.pair`, `chatter.topic`, `chatter.history` remain available.

Restart never replays an uncertain submitted turn, including the third group turn. Terminal conversation links disappear while history and artifacts remain. Group lines connect all three participants. Concurrent conversations use separate floor meeting positions; manual pins remain authoritative.

Imagen is projected from the actual configured OpenClaw inventory even without a workday activity entry. Its unobserved activity remains `unknown`; this does not invent workday controls, register a new runtime or make it an automatic text chatter participant.
