FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY . /site

RUN set -eu; \
    rm -rf /usr/share/nginx/html/*; \
    if [ -f /site/index.html ]; then \
      for path in /site/* /site/.[!.]* /site/..?*; do \
        [ -e "$path" ] || continue; \
        name="$(basename "$path")"; \
        case "$name" in \
          Dockerfile|README.md|compose.yaml|memo.md|nginx.conf|.dockerignore|.gitignore|.git|.codex) \
            continue ;; \
        esac; \
        cp -a "$path" /usr/share/nginx/html/; \
      done; \
    else \
      printf '%s\n' \
        '<!doctype html>' \
        '<html lang="ja">' \
        '  <head>' \
        '    <meta charset="utf-8" />' \
        '    <meta name="viewport" content="width=device-width, initial-scale=1" />' \
        '    <title>Koko-Task</title>' \
        '    <style>' \
        '      :root {' \
        '        color-scheme: dark;' \
        '        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;' \
        '        background: #0f0e17;' \
        '        color: #fffffe;' \
        '      }' \
        '      body {' \
        '        margin: 0;' \
        '        min-height: 100vh;' \
        '        display: grid;' \
        '        place-items: center;' \
        '        background:' \
        '          radial-gradient(circle at top, rgba(255, 137, 6, 0.12), transparent 35%),' \
        '          radial-gradient(circle at bottom right, rgba(229, 49, 112, 0.12), transparent 25%),' \
        '          #0f0e17;' \
        '      }' \
        '      main {' \
        '        max-width: 32rem;' \
        '        padding: 2rem;' \
        '        text-align: center;' \
        '      }' \
        '      h1 {' \
        '        margin: 0 0 0.75rem;' \
        '        font-size: clamp(2rem, 5vw, 3.25rem);' \
        '      }' \
        '      p {' \
        '        margin: 0.5rem 0;' \
        '        line-height: 1.7;' \
        '        color: #a7a5bc;' \
        '      }' \
        '      code {' \
        '        color: #ff8906;' \
        '      }' \
        '    </style>' \
        '  </head>' \
        '  <body>' \
        '    <main>' \
        '      <h1>Koko-Task</h1>' \
        '      <p>静的ファイルがまだ揃っていないため、コンテナはフォールバックページを返しています。</p>' \
        '      <p><code>index.html</code> や <code>assets/</code> が追加されると、そのまま配信されます。</p>' \
        '    </main>' \
        '  </body>' \
        '</html>' \
        > /usr/share/nginx/html/index.html; \
    fi; \
    if [ ! -f /usr/share/nginx/html/index.html ]; then \
      echo "missing index.html" >&2; \
      exit 1; \
    fi; \
    chown -R nginx:nginx /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/healthz >/dev/null || exit 1
