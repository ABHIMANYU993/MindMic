import socket
import sys
import json
from typing import Optional


def send_cmd(payload_str: str) -> None:
    """
    Sends a string command payload to the MindMic daemon via Unix TCP socket.

    Args:
        payload_str (str): The raw command string to transmit to the daemon.
                           Defaults mapped by the CLI layer include 'toggle_quick'
                           and 'toggle_retained'.
                           
    Raises:
        ConnectionRefusedError: If the daemon socket cannot be reached.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("127.0.0.1", 8766))
        
        # Send payload and signal no more writes
        s.sendall(payload_str.encode("utf-8"))
        s.shutdown(socket.SHUT_WR)
        
        # Read response stream
        data: bytes = b""
        while True:
            chunk: bytes = s.recv(4096)
            if not chunk:
                break
            data += chunk
        s.close()
        
        # Output strictly cleanly stripped JSON strings
        print(data.decode("utf-8").strip())
    except ConnectionRefusedError:
        print(json.dumps({"error": "Daemon is not running. Please start mindmic_native."}))
    except Exception as e:
        print(json.dumps({"error": f"Socket transmission failed: {str(e)}"}))


def main() -> None:
    """
    Entrypoint for the MindMic native CLI handler.
    Parses incoming CLI arguments and translates legacy Hyprland binds
    into native toggle actions.
    """
    if len(sys.argv) > 1:
        cmd: str = sys.argv[1]
        
        # Backward compatibility translation for hyprland keybindings
        if cmd in ["quick", "retained"]:
            send_cmd(f"toggle_{cmd}")
        else:
            send_cmd(cmd)

if __name__ == "__main__":
    main()
