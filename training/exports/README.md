# Local Trace Exports

Place JSONL files exported from Nebula's **Training Logs** page here before running:

```powershell
python training/scripts/build_colab_bundle.py
```

The bundle builder scans exports for common unredacted secret patterns. The Colab preparation step audits every example again and only admits daily-chat or safe read-only-tool traces that pass the Gemma quality gate.

Do not place API tokens, Hugging Face tokens, `.env` files, private keys, or raw browser profiles in this directory.
