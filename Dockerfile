FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/var/lib/chromaforge
WORKDIR /app
COPY --chown=node:node package.json LICENSE README.md ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps ./apps
COPY --chown=node:node examples ./examples
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node server ./server
COPY --chown=node:node docs ./docs
RUN node scripts/build.js && mkdir -p /var/lib/chromaforge && chown -R node:node /var/lib/chromaforge
USER node
EXPOSE 8787
VOLUME ["/var/lib/chromaforge"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
