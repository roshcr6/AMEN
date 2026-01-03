"""
AMEN System Verification Script
Checks all components are properly configured
"""

import os
import sys
from pathlib import Path

def check_env_file(path, required_vars):
    """Check if env file exists and has required variables"""
    if not path.exists():
        return False, f"File not found: {path}"
    
    with open(path, 'r') as f:
        content = f.read()
    
    missing = []
    for var in required_vars:
        if var not in content:
            missing.append(var)
    
    if missing:
        return False, f"Missing variables: {', '.join(missing)}"
    return True, "OK"

def main():
    print("=" * 60)
    print("AMEN System Verification")
    print("=" * 60)
    print()
    
    root = Path(__file__).parent
    all_ok = True
    
    # 1. Check root .env
    print("1. Root .env file:")
    root_env = root / ".env"
    ok, msg = check_env_file(root_env, [
        "SEPOLIA_RPC_URL",
        "DEPLOYER_PRIVATE_KEY",
        "GEMINI_API_KEY"
    ])
    print(f"   {'✅' if ok else '❌'} {msg}")
    if not ok:
        all_ok = False
    
    # 2. Check agent .env
    print("\n2. Agent .env file:")
    agent_env = root / "agent" / ".env"
    ok, msg = check_env_file(agent_env, [
        "SEPOLIA_RPC_URL",
        "AGENT_PRIVATE_KEY",
        "GEMINI_API_KEY"
    ])
    print(f"   {'✅' if ok else '❌'} {msg}")
    if not ok:
        all_ok = False
    
    # 3. Check backend .env
    print("\n3. Backend .env file:")
    backend_env = root / "backend" / ".env"
    ok, msg = check_env_file(backend_env, [
        "DATABASE_URL",
        "CORS_ORIGINS"
    ])
    print(f"   {'✅' if ok else '❌'} {msg}")
    if not ok:
        all_ok = False
    
    # 4. Check frontend .env
    print("\n4. Frontend .env file:")
    frontend_env = root / "frontend" / ".env"
    ok, msg = check_env_file(frontend_env, [
        "VITE_API_URL",
        "VITE_WS_URL"
    ])
    print(f"   {'✅' if ok else '❌'} {msg}")
    if not ok:
        all_ok = False
    
    # 5. Check smart contracts
    print("\n5. Smart Contracts:")
    contracts = [
        "contracts/src/tokens/MockWETH.sol",
        "contracts/src/tokens/MockUSDC.sol",
        "contracts/src/oracle/PriceOracle.sol",
        "contracts/src/amm/SimpleAMM.sol",
        "contracts/src/lending/LendingVault.sol"
    ]
    for contract in contracts:
        exists = (root / contract).exists()
        print(f"   {'✅' if exists else '❌'} {contract}")
        if not exists:
            all_ok = False
    
    # 6. Check agent files
    print("\n6. Agent Python Files:")
    agent_files = [
        "agent/main.py",
        "agent/observer.py",
        "agent/reasoner.py",
        "agent/decider.py",
        "agent/actor.py",
        "agent/reporter.py",
        "agent/config.py",
        "agent/abis.py"
    ]
    for f in agent_files:
        exists = (root / f).exists()
        print(f"   {'✅' if exists else '❌'} {f}")
        if not exists:
            all_ok = False
    
    # 7. Check backend files
    print("\n7. Backend Files:")
    backend_files = [
        "backend/main.py",
        "backend/models.py",
        "backend/requirements.txt"
    ]
    for f in backend_files:
        exists = (root / f).exists()
        print(f"   {'✅' if exists else '❌'} {f}")
        if not exists:
            all_ok = False
    
    # 8. Check frontend files
    print("\n8. Frontend Files:")
    frontend_files = [
        "frontend/src/App.tsx",
        "frontend/src/api.ts",
        "frontend/package.json",
        "frontend/vite.config.ts"
    ]
    for f in frontend_files:
        exists = (root / f).exists()
        print(f"   {'✅' if exists else '❌'} {f}")
        if not exists:
            all_ok = False
    
    # Summary
    print("\n" + "=" * 60)
    if all_ok:
        print("✅ ALL CHECKS PASSED!")
        print("\nNext Steps:")
        print("1. Install dependencies:")
        print("   cd contracts && npm install")
        print("   cd ../agent && pip install -r requirements.txt")
        print("   cd ../backend && pip install -r requirements.txt")
        print("   cd ../frontend && npm install")
        print("\n2. Deploy contracts:")
        print("   cd contracts && npx hardhat run scripts/deploy.js --network sepolia")
        print("\n3. Update .env files with contract addresses")
        print("\n4. Start services in separate terminals:")
        print("   cd backend && uvicorn main:app --reload")
        print("   cd agent && python main.py")
        print("   cd frontend && npm run dev")
    else:
        print("❌ SOME CHECKS FAILED - See issues above")
        return 1
    
    print("=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())
