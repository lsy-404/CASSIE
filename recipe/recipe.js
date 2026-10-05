export async function deploy(ctx) {
  await ctx.step('assets', 'running');
  const assets = await ctx.assets.upload();
  await ctx.step('assets', 'success');

  await ctx.step('worker', 'running');
  const { versionId } = await ctx.worker.uploadVersion({ assets });
  await ctx.worker.switchTraffic(versionId);
  await ctx.step('worker', 'success');

  const domain = String(ctx.ctx.domain || '').trim();
  if (domain) {
    await ctx.step('domain', 'running');
    await ctx.domains.attach(domain);
    await ctx.step('domain', 'success');
    await ctx.result({ url: `https://${domain}` });
  } else {
    await ctx.step('domain', 'skipped');
  }
}
