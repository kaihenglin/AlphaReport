#!/bin/bash

# ResearchAgent 一键启动脚本
# 同时启动后端 (8000) 和前端 (3000)

cd "$(dirname "$0")"

cleanup() {
    echo ""
    echo "正在停止服务..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo "已停止"
    exit 0
}

trap cleanup INT TERM

# 检查端口占用
for port in 8000 3000; do
    pid=$(lsof -ti :$port 2>/dev/null)
    if [ -n "$pid" ]; then
        echo "端口 $port 已被占用 (PID: $pid)，正在停止..."
        kill $pid 2>/dev/null
        sleep 1
    fi
done

# 启动后端
echo "启动后端 (http://127.0.0.1:8000) ..."
source .venv/bin/activate
PYTHONPATH=. python -m uvicorn reportagent.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

# 等后端就绪
sleep 2

# 启动前端
echo "启动前端 (http://localhost:3000) ..."
cd frontend-v2
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================="
echo "  前端: http://localhost:3000"
echo "  后端: http://127.0.0.1:8000/docs"
echo "  按 Ctrl+C 停止所有服务"
echo "========================================="
echo ""

wait
