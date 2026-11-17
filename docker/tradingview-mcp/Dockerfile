# TradingView MCP — current upstream from the official PyPI package.
# The old atilaahmet/tradingview-mcp image is a March-2026 crypto-only build
# with 11 tools. This exposes the current TA/screener set and India NSE/BSE
# support via stock_screener / stock_prices.
FROM python:3.13-slim
RUN pip install --no-cache-dir tradingview-mcp-server==0.8.1
EXPOSE 8000
CMD ["tradingview-mcp", "streamable-http", "--host", "0.0.0.0", "--port", "8000"]
