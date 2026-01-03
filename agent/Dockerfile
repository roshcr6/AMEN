# Agent Dockerfile for Cloud Run
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent code
COPY . .

# Environment variables will be set in Cloud Run
ENV PYTHONIOENCODING=utf-8

# Expose port (Cloud Run requires it even for background services)
EXPOSE 8080

# Run the agent
CMD python main.py
