from jupyter_client import AsyncKernelManager
import asyncio

async def start_kernel():
    km = AsyncKernelManager(kernel_name="python3")
    await km.start_kernel()
    kc = km.client()  # <-- this returns the non-blocking KernelClient
    await kc.start_channels()
    kc.register_comm_target('ipyflow', handle_open)
    # Now execute any reactive cell:
    kc.execute("x = 1", metadata={'ipyflow':{'reactive':True}})

def handle_open(msg):
    comm_id = msg['content']['comm_id']
    comm = kc.comm_manager.get_comm(comm_id)
    @comm.on_msg
    def _recv(msg2):
        data = msg2['content']['data']
        print("ipyflow event:", data.get('type'), data.get('payload'))

asyncio.run(start_kernel())
