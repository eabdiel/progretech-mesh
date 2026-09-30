export const factoryActions = new Set('factory.status host.overview host.system models.list audio.get audio.set voice.get voice.start voice.stop voice.providers voice.preview voice.select voice.settings vision.get vision.analyze chatter.get chatter.settings chatter.test skills.list mail.status orchestration.status harness.status grid.status vllm.status'.split(' '));
export async function forwardFactoryControl(payload, token, fetchImpl = fetch) {
 if (!payload || !factoryActions.has(payload.action)) throw new Error('action_not_allowed');
 const args=payload.args ?? {};
 if (typeof args !== 'object' || Array.isArray(args) || !args) throw new Error('invalid_args');
 if (!token) throw new Error('local_auth_missing');
 const body=JSON.stringify({action:payload.action,args});
 if (body.length>60000) throw new Error('request_too_large');
 const r=await fetchImpl('http://127.0.0.1:8787/api/factory/control', {method:'POST', headers:{'Content-Type':'application/json','X-ProgreTech-Mesh-Local-Token':token},body,redirect:'error',signal:AbortSignal.timeout(43000)});
 if (!r.ok) throw new Error(`host_control_http_${r.status}`);
 return await r.json();
}
