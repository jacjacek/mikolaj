"""CDP client for an explicitly started remote-deployment QA browser."""
import base64
import json
import time
from pathlib import Path
from websockets.sync.client import connect

class Browser:
    @classmethod
    def from_endpoint(cls, endpoint):
        self=cls()
        self.ws=connect(endpoint,open_timeout=15,max_size=20000000,proxy=None,compression=None)
        self.counter=0
        self.sid=None
        self.events=[]
        return self

    def call(self, method, browser=False, **params):
        self.counter+=1
        message={'id':self.counter,'method':method,'params':params}
        if self.sid and not browser:
            message['sessionId']=self.sid
        self.ws.send(json.dumps(message))
        while True:
            response=json.loads(self.ws.recv(timeout=30))
            if response.get('id')!=self.counter:
                if 'method' in response:
                    self.events.append(response)
                    self.events=self.events[-512:]
                continue
            if 'error' in response:
                raise RuntimeError(str(response['error']))
            return response.get('result',{})

    def wait_event(self, method, timeout=45):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            for i,event in enumerate(self.events):
                if event.get('method')==method and event.get('sessionId')==self.sid:
                    self.events.pop(i)
                    return event.get('params',{})
            event=json.loads(self.ws.recv(timeout=max(.1,deadline-time.monotonic())))
            if 'method' in event:
                self.events.append(event)
                self.events=self.events[-512:]
        raise TimeoutError('No '+method+' before navigation deadline')

    def page(self, url, init_script=None):
        target=self.call('Target.createTarget',browser=True,url='about:blank')['targetId']
        self.sid=self.call('Target.attachToTarget',browser=True,targetId=target,flatten=True)['sessionId']
        self.call('Target.activateTarget',browser=True,targetId=target)
        self.call('Page.enable')
        if init_script is not None:
            self.call('Page.addScriptToEvaluateOnNewDocument',source=init_script)
        self.events.clear()
        self.call('Page.navigate',url=url)
        self.wait_event('Page.loadEventFired')
        return self

    def js(self, expression):
        response=self.call('Runtime.evaluate',expression=expression,returnByValue=True,awaitPromise=True)
        if response.get('exceptionDetails'):
            raise RuntimeError(str(response['exceptionDetails']))
        return response.get('result',{}).get('value')

    def viewport(self, width, height, mobile=True):
        self.call('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=mobile)

    def screenshot(self, path):
        response=self.call('Page.captureScreenshot',format='png',captureBeyondViewport=False)
        Path(path).write_bytes(base64.b64decode(response['data']))
        return path
