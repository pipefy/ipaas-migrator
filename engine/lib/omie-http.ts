// Acoes do conector custom Omie nao trazem request.url. O corpo da receita e o
// `param` da API JSON publica (app.omie.com.br). app_key/app_secret nao ficam
// no flow: viram variaveis do projeto iPaaS.

export const OMIE_APP_KEY = 'OMIE_APP_KEY';
export const OMIE_APP_SECRET = 'OMIE_APP_SECRET';

export interface OmieCall {
  url: string;
  call: string;
}

/** Acao Workato (depois do collapse `omie/`) -> endpoint e `call` da API. */
export const OMIE_CALLS: Record<string, OmieCall> = {
  listar_movimentos: {
    url: 'https://app.omie.com.br/api/v1/financas/mf/',
    call: 'ListarMovimentos',
  },
  listar_clientes: {
    url: 'https://app.omie.com.br/api/v1/geral/clientes/',
    call: 'ListarClientes',
  },
  incluir_conta_pagar: {
    url: 'https://app.omie.com.br/api/v1/financas/contapagar/',
    call: 'IncluirContaPagar',
  },
};

export function omieActionName(collapsedOpKey: string): string {
  const slash = collapsedOpKey.indexOf('/');
  if (slash < 0) return '';
  const provider = collapsedOpKey.slice(0, slash);
  const action = collapsedOpKey.slice(slash + 1);
  if (provider !== 'omie' || action === '__adhoc_http_action') return '';
  return action;
}

/** Input plano do send_request. O envelope `body.data` fica com o flow-builder. */
export function omieHttpInput(action: string, param: Record<string, unknown>): Record<string, unknown> | null {
  const spec = OMIE_CALLS[action];
  if (!spec) return null;
  return {
    method: 'POST',
    url: spec.url,
    headers: {},
    queryParams: {},
    authType: 'none',
    body_type: 'json',
    body: {
      call: spec.call,
      app_key: `{{variables['${OMIE_APP_KEY}']}}`,
      app_secret: `{{variables['${OMIE_APP_SECRET}']}}`,
      param: [param],
    },
  };
}
