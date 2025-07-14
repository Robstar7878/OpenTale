"""Configuration for the book generation system"""

import os
from typing import Dict

from dotenv import load_dotenv

load_dotenv()


def get_config() -> Dict:
    """Get the configuration for the agents"""

    # Basic config for local LLM
    config_list = [
        {
            "model": os.getenv("MODEL", "google/gemini-2.5-flash"),
            "base_url": os.getenv("BASE_URL", "https://openrouter.ai/api/v1"),
            "api_key": os.getenv("API_KEY"),
        }
    ]

    # Common configuration for all agents
    agent_config = {
        "seed": int(os.getenv("SEED", 42)),
        "temperature": float(os.getenv("TEMPERATURE", 0.7)),
        "top_p": float(os.getenv("TOP_P", 1.0)),
        "config_list": config_list,
        "timeout": int(os.getenv("TIMEOUT", 1000)),
        "cache_seed": None,
        "max_tokens": int(os.getenv("MAX_TOKENS", 10000)),
    }

    return agent_config
