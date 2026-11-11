"""CDP client for an explicitly started remote-deployment QA browser."""
import base64
import json
from pathlib import Path
from websockets.sync.client import connect

class Browser:
    @classmethod
    def from_endpoint(cls, endpoint):
        self=cls()
        self.ws=connect(endpoint,open_timeout=15,max_size=20000000,proxy=None,compression=None)
        self.counter=0
        self.sid=None
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
                continue
            if 'error' in response:
                raise RuntimeError(str(response['error']))
            return response.get('result',{})

    def page(self, url):
        target=self.call('Target.createTarget',browser=True,url=url)['targetId']
        self.sid=self.call('Target.attachToTarget',browser=True,targetId=target,flatten=True)['sessionId']
        self.call('Target.activateTarget',browser=True,targetId=target)
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
