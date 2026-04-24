import socket
import sys
import json


def send_cmd(payload_str):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", 8766))
        # Send payload and signal no more writes
        s.sendall(payload_str.encode("utf-8"))
        s.shutdown(socket.SHUT_WR)
        
        # Read response
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()
        
        print(data.decode("utf-8").strip())
    except ConnectionRefusedError:
        print(json.dumps({"error": "Daemon is not running."}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        # Backward compatibility for hyprland keybindings
        if cmd in ["quick", "retained"]:
            send_cmd(f"toggle_{cmd}")
        else:
            send_cmd(cmd)
