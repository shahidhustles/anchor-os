import json
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from serve import make_server
from common import validate_request


class ServiceTest(unittest.TestCase):
    def setUp(self):
        class Router:
            def route(self, request):
                if request['user_task'] == 'bad output':
                    raise ValueError('Invalid output')
                return {'model_slug': request['candidate_models'][0], 'confidence': .8}
        self.server = make_server(Router(), 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_health_and_bad_request_recovery(self):
        self.assertEqual(json.load(urlopen(self.url+'/health'))['status'], 'ready')
        for body in [[], {}, {'user_task': 'x', 'candidate_models': ['a'], 'profiles': [None]}]:
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(self.url+'/route', data=json.dumps(body).encode(),
                                headers={'Content-Type': 'application/json'}))
            self.assertEqual(error.exception.code, 400)
        self.assertEqual(urlopen(self.url+'/health').status, 200)

    def test_reject_browser_origin(self):
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.url+'/health', headers={'Origin': 'https://example.com'}))
        self.assertEqual(error.exception.code, 403)

    def test_non_object_request(self):
        with self.assertRaises(ValueError):
            validate_request([])


if __name__ == '__main__':
    unittest.main()
