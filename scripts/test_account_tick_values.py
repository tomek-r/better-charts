"""Run the EA tick-probe function with mocked MT5 APIs; never start MT5."""
from pathlib import Path
import subprocess, tempfile
ROOT = Path(__file__).resolve().parents[1]
source=(ROOT / 'mql5/bridge/Experts/BetterChartsBridge.mq5').read_text().split('string AccountTickValuesJson',1)[1].split('string SymbolMetadataJson',1)[0]
harness=r'''
#include <cmath>
#include <string>
#include <sstream>
#include <iomanip>
#include <cstdio>
#include <cassert>
using string=std::string;
const int ACCOUNT_CURRENCY=1,ACCOUNT_CURRENCY_DIGITS=2,SYMBOL_VOLUME_MIN=3,SYMBOL_VOLUME_MAX=4,SYMBOL_VOLUME_STEP=5,ORDER_TYPE_BUY=0;
struct MqlTick {double ask;};
int digits=2; double gain=0.01,loss=0.01; bool available=true; int calls=0;
string AccountInfoString(int){return "USD";}
long AccountInfoInteger(int){return digits;}
double SymbolInfoDouble(string,int property){return property==SYMBOL_VOLUME_MAX?100:0.1;}
bool SymbolInfoTick(string,MqlTick& q){q.ask=31000;return available;}
double MathMin(double a,double b){return std::fmin(a,b);} double MathMax(double a,double b){return std::fmax(a,b);}
double MathFloor(double a){return std::floor(a);} double MathPow(double a,double b){return std::pow(a,b);}
bool MathIsValidNumber(double a){return std::isfinite(a);} string JsonEscape(string s){return s;}
string DoubleToString(double value,int places){std::ostringstream s;s<<std::fixed<<std::setprecision(places)<<value;return s.str();}
template<typename... T> string StringFormat(const char* fmt,T... args){char out[512];std::snprintf(out,sizeof(out),fmt,args.c_str()...);return out;}
bool OrderCalcProfit(int,string,double volume,double entry,double exit,double& profit){calls++; double ticks=(exit-entry)/0.01;double scale=std::pow(10,digits);profit=std::round(ticks*(ticks<0?loss:gain)*volume*scale)/scale;return true;}
'''
harness+='string AccountTickValuesJson'+source
harness+=r'''
int main(){
 auto result=AccountTickValuesJson("NAS100",0.01);
 assert(result.find("null")==string::npos);
 assert(result.find("0.01000000")!=string::npos);
 digits=0; gain=0.01;loss=0.02;calls=0;
 result=AccountTickValuesJson("NAS100",0.01);
 assert(result.find("0.01000000")!=string::npos);
 assert(result.find("0.02000000")!=string::npos);
 assert(calls<=12);
 digits=3; gain=loss=0.0001;calls=0;
 result=AccountTickValuesJson("NAS100",0.01);
 assert(result.find("0.00010000")!=string::npos); assert(calls<=12);
 available=false; assert(AccountTickValuesJson("NAS100",0.01).find("null")!=string::npos);
 available=true;gain=loss=0;calls=0;
 assert(AccountTickValuesJson("NAS100",0.01).find("null")!=string::npos);
 assert(calls<=12);
}
'''
with tempfile.TemporaryDirectory() as folder:
 p=Path(folder); (p/'test.cpp').write_text(harness)
 subprocess.run(['c++','-std=c++17',str(p/'test.cpp'),'-o',str(p/'test')],check=True)
 subprocess.run([str(p/'test')],check=True)
print('Account tick probe regressions passed')
